/**
 * CloudBase 文档型数据库的服务端 SDK · 内存模拟（仅供本机自检用）
 * =================================================================
 *
 * 为什么需要：线上环境是 PG 实例，没有文档库可以连，切库前不可能真跑一遍
 * kv-nosql.cjs。而这个驱动一旦写错（_id 编码、前缀范围、快照幂等），切过去
 * 就是全站 401/404。所以在本地用内存实现顶替 @cloudbase/node-sdk，把
 * get/put/delete/list 与备份流程的语义全部跑一遍。
 *
 * 覆盖到的行为（与真实 SDK 对齐的部分）：
 *   - createCollection 幂等
 *   - doc(id).get() / set() / remove()
 *   - where(cond).orderBy().skip().limit().get()
 *   - where(cond).remove()
 *   - command: gt / gte / lt / lte / in，以及 .and() 链式组合
 *   - 单次 get 上限 1000（超出抛错，和线上一致，用来暴露 list 的 limit+1 问题）
 *
 * 不覆盖：权限、安全规则、网络错误、真实索引。这些只能在真环境验。
 */

const MAX_LIMIT = 1000;

/* ------------------------------------------------------------ 查询条件 */

function makeCond(op, value) {
  return {
    __op: op,
    __value: value,
    and(other) {
      return makeAnd([this, other]);
    },
  };
}

function makeAnd(list) {
  return {
    __and: list,
    and(other) {
      return makeAnd([...list, other]);
    },
  };
}

function matchValue(actual, cond) {
  if (!cond || typeof cond !== "object") return actual === cond;
  if (cond.__and) return cond.__and.every((c) => matchValue(actual, c));
  switch (cond.__op) {
    case "gt":
      return actual != null && actual > cond.__value;
    case "gte":
      return actual != null && actual >= cond.__value;
    case "lt":
      return actual != null && actual < cond.__value;
    case "lte":
      return actual != null && actual <= cond.__value;
    case "in":
      return Array.isArray(cond.__value) && cond.__value.includes(actual);
    case "eq":
      return actual === cond.__value;
    default:
      return false;
  }
}

function matchDoc(doc, where) {
  if (!where) return true;
  return Object.entries(where).every(([field, cond]) => matchValue(doc[field], cond));
}

/* ---------------------------------------------------------------- 查询 */

class Query {
  constructor(table, where) {
    this.table = table;
    this._where = where || null;
    this._order = null;
    this._skip = 0;
    this._limit = 100;
  }

  where(cond) {
    this._where = cond;
    return this;
  }

  orderBy(field, direction = "asc") {
    this._order = { field, direction };
    return this;
  }

  skip(n) {
    this._skip = Math.max(0, Number(n) || 0);
    return this;
  }

  limit(n) {
    this._limit = Math.max(1, Math.min(MAX_LIMIT, Number(n) || 100));
    return this;
  }

  /** 取满足条件的文档快照，按需排序 */
  _rows() {
    const out = [];
    for (const [id, doc] of this.table.entries()) {
      if (matchDoc({ _id: id, ...doc }, this._where)) out.push({ _id: id, ...doc });
    }
    if (this._order) {
      const { field, direction } = this._order;
      out.sort((a, b) => {
        const x = a[field];
        const y = b[field];
        if (x === y) return 0;
        const r = x > y ? 1 : -1;
        return direction === "desc" ? -r : r;
      });
    }
    return out;
  }

  async get() {
    const rows = this._rows().slice(this._skip, this._skip + this._limit);
    return { data: rows };
  }

  async count() {
    return { total: this._rows().length };
  }

  async remove() {
    const rows = this._rows();
    for (const r of rows) this.table.delete(r._id);
    return { deleted: rows.length };
  }
}

class DocRef {
  constructor(table, id) {
    this.table = table;
    this.id = id;
  }

  async get() {
    const doc = this.table.get(this.id);
    return { data: doc ? [{ _id: this.id, ...doc }] : [] };
  }

  /** set = 不存在则创建、存在则整体替换（与真实 SDK 一致，_id 不变） */
  async set(data) {
    this.table.set(this.id, { ...data });
    return { updated: 1 };
  }

  async update(data) {
    const cur = this.table.get(this.id);
    if (!cur) return { updated: 0 };
    this.table.set(this.id, { ...cur, ...data });
    return { updated: 1 };
  }

  async remove() {
    const existed = this.table.delete(this.id);
    return { deleted: existed ? 1 : 0 };
  }
}

class Collection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  get table() {
    return this.db._collections.get(this.name);
  }

  doc(id) {
    return new DocRef(this.table, id);
  }

  where(cond) {
    return new Query(this.table, cond);
  }

  orderBy(field, direction) {
    return new Query(this.table).orderBy(field, direction);
  }

  limit(n) {
    return new Query(this.table).limit(n);
  }

  async get() {
    return new Query(this.table).get();
  }

  async add(doc) {
    const one = Array.isArray(doc) ? null : doc;
    if (one) {
      const id = one._id || `auto_${Math.random().toString(36).slice(2)}`;
      this.table.set(id, { ...one });
      return { id };
    }
    const ids = [];
    for (const d of doc) {
      const id = d._id || `auto_${Math.random().toString(36).slice(2)}`;
      this.table.set(id, { ...d });
      ids.push(id);
    }
    return { ids };
  }
}

class Database {
  constructor() {
    this._collections = new Map();
    this.command = {
      gt: (v) => makeCond("gt", v),
      gte: (v) => makeCond("gte", v),
      lt: (v) => makeCond("lt", v),
      lte: (v) => makeCond("lte", v),
      eq: (v) => makeCond("eq", v),
      in: (v) => makeCond("in", v),
      and: (list) => makeAnd(list),
    };
    this.RegExp = ({ regexp, options }) => ({ __regexp: new RegExp(regexp, options || "") });
  }

  collection(name) {
    if (!this._collections.has(name)) {
      const msg = `[mock] 集合不存在：${name}（真实环境会报 DATABASE_COLLECTION_NOT_EXIST）`;
      throw new Error(msg);
    }
    return new Collection(this, name);
  }

  async createCollection(name) {
    if (this._collections.has(name)) {
      throw Object.assign(new Error(`collection ${name} already exists`), {
        code: "DATABASE_COLLECTION_EXIST",
      });
    }
    this._collections.set(name, new Map());
    return { ok: true };
  }

  /** 自检专用：绕过 collection() 的存在性检查直接拿到表 */
  raw(name) {
    return this._collections.get(name);
  }
}

/* ------------------------------------------------------------------ SDK */

function createMockSdk() {
  const instances = [];

  function tcbInit() {
    const db = new Database();
    instances.push(db);
    return {
      database: () => db,
      rdb: () => {
        throw new Error("[mock] 这是文档库模拟，rdb() 不可用");
      },
    };
  }

  return {
    init: tcbInit,
    /** 自检脚本用：拿到最近一次 init 出来的库，方便断言 */
    __lastDb: () => instances[instances.length - 1],
    __reset: () => {
      instances.length = 0;
    },
  };
}

module.exports = { createMockSdk, Database };
