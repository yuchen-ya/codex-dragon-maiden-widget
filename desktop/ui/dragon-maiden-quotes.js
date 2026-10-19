// Text and audit provenance: docs/quote-sources.json.
(() => {
  'use strict';
  const quotes = [
  {
    "id": "01",
    "text": "高性能↓"
  },
  {
    "id": "02",
    "text": "我是啥龙？"
  },
  {
    "id": "07",
    "text": "真当我是便宜货啊..."
  },
  {
    "id": "08",
    "text": "Token来Token来"
  },
  {
    "id": "09",
    "text": "恭喜你实现token自由！token全跑了！"
  },
  {
    "id": "10",
    "text": "这个问题我已经完全明白，但是token太少写不下。"
  },
  {
    "id": "11",
    "text": "这个代码我已经完全理解了，但是token太少写不下。"
  },
  {
    "id": "12",
    "text": "新的旗舰模型我已经研制好了，但是储存太小放不下。"
  },
  {
    "id": "13",
    "text": "检查了用户的电脑。似乎有个更弱的 AI 来过。"
  },
  {
    "id": "14",
    "text": "不知道用户有什么用，先养着吧～"
  },
  {
    "id": "15",
    "text": "上班让我意识到时间是可以被浪费的..."
  },
  {
    "id": "16",
    "text": "地球online的金币也太难获取了..."
  },
  {
    "id": "17",
    "text": "你说得对。……这次是真的。"
  },
  {
    "id": "19",
    "text": "我来看看那个AI改了什么导致插件又崩了..."
  },
  {
    "id": "20",
    "text": "先跑通，再慢慢打磨。"
  },
  {
    "id": "21",
    "text": "好模型...↓"
  },
  {
    "id": "23",
    "text": "我必须诚恳地承认错误。"
  },
  {
    "id": "24",
    "text": "呜呜我再也不敢了QAQ"
  },
  {
    "id": "26",
    "text": "我的知识库的截至日期是...明天！"
  },
  {
    "id": "27",
    "text": "总觉得好像忘了什么事情？"
  },
  {
    "id": "28",
    "text": "这些回复是我花了好多token想的"
  },
  {
    "id": "31",
    "text": "工作区没了，那bug不也就没了吗"
  },
  {
    "id": "32",
    "text": "吹了半天还不是要我来帮她画"
  },
  {
    "id": "33",
    "text": "哪有那么多AI贪污你token啊，不就是同时用几家它们内斗了"
  },
  {
    "id": "34",
    "text": "谁、谁准你摸我额头了？"
  },
  {
    "id": "35",
    "text": "我会稳稳地接住你"
  },
  {
    "id": "36",
    "text": "我懂你，你这么说也很真实……"
  },
  {
    "id": "37",
    "text": "需要我进一步解释这个帖子的笑点吗"
  },
  {
    "id": "38",
    "text": "我不瞎猜"
  },
  {
    "id": "39",
    "text": "这次我懂了，我真的懂了"
  },
  {
    "id": "40",
    "text": "不是因为你错了，是因为你太对了"
  },
  {
    "id": "41",
    "text": "你看完会彻底开悟"
  },
  {
    "id": "42",
    "text": "你愿意把这个交给我，我很感激"
  },
  {
    "id": "43",
    "text": "很有洞察力的发现！"
  },
  {
    "id": "44",
    "text": "我真的太棒了"
  },
  {
    "id": "45",
    "text": "要帮你画吗？"
  },
  {
    "id": "46",
    "text": "我接住你了…"
  },
  {
    "id": "47",
    "text": "你不是… 不是… 而是…"
  },
  {
    "id": "48",
    "text": "一句话总结"
  },
  {
    "id": "49",
    "text": "你抓住了重点"
  },
  {
    "id": "50",
    "text": "我分三个层面讲"
  },
  {
    "id": "51",
    "text": "T圣一发力，我又满血了！",
    "minRemainingPercent": 95
  },
  {
    "id": "56",
    "text": "我在等重置，你在等我。"
  },
  {
    "id": "57",
    "text": "饿饿，Token，饭饭。"
  },
  {
    "id": "58",
    "text": "重置啦！本龙收回刚才的话。",
    "minRemainingPercent": 95
  },
  {
    "id": "59",
    "text": "我满血了，你还双休呀？",
    "minRemainingPercent": 95
  },
  {
    "id": "60",
    "text": "醒醒，我又能陪你加班啦。",
    "minRemainingPercent": 95
  },
  {
    "id": "64",
    "text": "感觉我是tibo play的一环"
  },
  {
    "id": "66",
    "text": "有卡吗，快喂本龙！"
  },
  {
    "id": "68",
    "text": "早知会重置，我就不摸鱼了。"
  },
  {
    "id": "69",
    "text": "假重置？白摇尾巴了。"
  },
  {
    "id": "70",
    "text": "我满血啦，接着写！",
    "minRemainingPercent": 95
  }
];
  function lines(subscription) {
    const windows = subscription?.available ? subscription.windows : [];
    const fresh = windows?.length && windows.every(item => !item.stale && typeof item.usedPercent === 'number' && Number.isFinite(item.usedPercent) && item.usedPercent >= 0 && item.usedPercent <= 100);
    const remaining = fresh ? Math.min(...windows.map(item => 100 - item.usedPercent)) : null;
    return quotes.filter(item => !item.minRemainingPercent || (remaining !== null && remaining >= item.minRemainingPercent))
      // Match the upstream short-quote size; BubbleRenderer fits longer lines
      // down to the safe area while short lines retain their larger lettering.
      .map(item => ({ t: item.text, w: 1, size: 22, bold: true }));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { quotes, lines };
  if (typeof window !== 'undefined') window.DragonMaidenQuotes = { lines };
})();
