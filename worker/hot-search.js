/**
 * 热点搜索（纯函数，无 IO）
 * ========================
 *
 * 页面上那个搜索框背后就是这里的匹配规则。放在 worker/ 而不是前端，
 * 是因为「能不能搜到」由服务端决定（前端只拿结果），本地测试、线上行为
 * 必须用同一份代码，否则会出现「本地搜得到、线上搜不到」。
 *
 * 为什么不是简单的 includes：
 *   1. 英文短词不能按子串匹配。搜「ai」时 `said` / `chain` / `retail` 全中，
 *      结果里会混进一堆和 AI 无关的标题。ASCII 词一律加词边界。
 *   2. 中文没有词边界，只能子串。搜「英伟达」就该命中「英伟达市值破纪录」，
 *      这条用词边界反而搜不到。
 *   3. 多个关键词按 AND。搜「苹果 芯片」要同时出现，这是读者真正的意图，
 *      不是「苹果」或「芯片」二选一。
 */

const MAX_NEEDLES = 6;
const MAX_QUERY_LEN = 60;

/** 只当“英文词”处理：字母数字开头，允许 . + # & ' - 这类出现在版本号和公司名里的字符 */
const ASCII_WORD = /^[a-z0-9][a-z0-9.+#&'-]*$/i;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 查询串 → 关键词数组（去空、限长、限个数） */
function queryNeedles(q) {
  return String(q || "")
    .trim()
    .slice(0, MAX_QUERY_LEN)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_NEEDLES);
}

/** 一条热点的可搜索文本：标题 + 导语 + 来源名（来源也要能搜，读者常按媒体找） */
function haystackOf(item) {
  return `${item.title || ""} ${item.summary || ""} ${item.sourceName || ""}`;
}

/**
 * 生成一个匹配器；q 为空时返回 null（调用方据此跳过整轮过滤，
 * 不要把空查询当成「匹配一切」的正则去跑一遍全表）。
 */
function makeMatcher(q) {
  const needles = queryNeedles(q);
  if (!needles.length) return null;

  const tests = needles.map((n) => {
    if (ASCII_WORD.test(n)) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(n)}(?![a-z0-9])`, "i");
      return (hay) => re.test(hay);
    }
    const low = n.toLowerCase();
    return (hay) => hay.toLowerCase().includes(low);
  });

  return (item) => {
    const hay = haystackOf(item);
    return tests.every((t) => t(hay));
  };
}

/** 过滤一批热点。q 为空时原样返回（同一个数组引用，省一次拷贝）。 */
function searchHotItems(items, q) {
  const match = makeMatcher(q);
  if (!match) return items;
  return items.filter(match);
}

export { queryNeedles, searchHotItems, makeMatcher };
