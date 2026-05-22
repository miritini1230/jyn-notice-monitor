const USER_IDX = 25488714;
const API_URL = "https://api.pandalive.co.kr/v1/bj_notice";
const NOTICE_PAGE_URL = "https://www.pandalive.co.kr/channel/podo0311/notice";
const ERROR_COOLDOWN_SECONDS = 3600;
const RECENT_CACHE_SIZE = 5;

async function fetchNotices() {
  const body = new URLSearchParams({
    userIdx: String(USER_IDX),
    offset: "0",
    limit: "10",
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/150.0",
      "Accept": "*/*",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Referer": "https://www.pandalive.co.kr/",
      "Origin": "https://www.pandalive.co.kr",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`PandaTV API HTTP ${response.status}`);
  }
  return await response.json();
}

function pickRecentNonPinned(payload, n) {
  const items = (payload.list || []).filter((x) => !x.isTop);
  items.sort((a, b) => b.idx - a.idx);
  return items.slice(0, n);
}

function cleanHtml(text) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function telegramEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegram(env, message) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: "false",
  });

  const response = await fetch(url, {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
  }
}

async function sendTelegramPhoto(env, photoUrl, caption) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const body = new URLSearchParams({
    chat_id: env.TELEGRAM_CHAT_ID,
    photo: photoUrl,
    caption: caption,
  });

  const response = await fetch(url, {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram sendPhoto error: ${JSON.stringify(result)}`);
  }
}

async function sendNoticeWithImage(env, message, imgUrl) {
  await sendTelegram(env, message);
  if (imgUrl) {
    try {
      await sendTelegramPhoto(env, imgUrl, "🖼️ 첨부 이미지");
    } catch (e) {
      console.error("sendTelegramPhoto failed:", e);
    }
  }
}

function buildNewMessage(notice) {
  const contents = telegramEscape(cleanHtml(notice.contents));
  return (
    `🔔 <b>주여닝 새 공지</b>\n\n${contents}\n\n` +
    `<i>작성: ${notice.insertDateTime}</i>\n` +
    `<a href="${NOTICE_PAGE_URL}">공지 페이지 열기</a>`
  );
}

function buildEditMessage(notice) {
  const contents = telegramEscape(cleanHtml(notice.contents));
  return (
    `✏️ <b>주여닝 공지 수정됨</b>\n\n${contents}\n\n` +
    `<i>작성: ${notice.insertDateTime}</i>\n` +
    `<a href="${NOTICE_PAGE_URL}">공지 페이지 열기</a>`
  );
}

async function loadRecentCache(env) {
  const str = await env.NOTICE_STATE.get("recent_notices");
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error("recent_notices parse error, treating as empty:", e);
    return null;
  }
}

async function saveRecentCache(env, recent) {
  const slim = recent.map((n) => ({
    idx: n.idx,
    contents: n.contents,
    imgMainSrc: n.imgMainSrc || "",
    insertDateTime: n.insertDateTime,
  }));
  await env.NOTICE_STATE.put("recent_notices", JSON.stringify(slim));
}

async function notifyError(env, error) {
  const lastAlert = await env.NOTICE_STATE.get("last_error_alert_at");
  if (lastAlert) {
    console.log("Error notification suppressed due to cooldown");
    return;
  }

  try {
    const errorMsg = telegramEscape(error.message || String(error));
    const message =
      `⚠️ <b>주여닝 감시 시스템 에러</b>\n\n` +
      `${errorMsg}\n\n` +
      `<i>1시간 동안 동일 알림이 더 오지 않습니다. 확인해주세요.</i>`;
    await sendTelegram(env, message);
    await env.NOTICE_STATE.put("last_error_alert_at", String(Date.now()), {
      expirationTtl: ERROR_COOLDOWN_SECONDS,
    });
    console.log("Error notification sent");
  } catch (e) {
    console.error("Failed to send error notification:", e);
  }
}

async function run(env) {
  const payload = await fetchNotices();
  if (!payload.result) {
    throw new Error("API returned result=false");
  }

  const recent = pickRecentNonPinned(payload, RECENT_CACHE_SIZE);
  if (recent.length === 0) {
    console.log("No non-pinned notice found");
    return;
  }

  const cache = await loadRecentCache(env);
  const lastSeenStr = await env.NOTICE_STATE.get("last_seen_idx");
  const lastSeenIdx = lastSeenStr ? parseInt(lastSeenStr, 10) : 0;
  const maxIdx = Math.max(...recent.map((n) => n.idx));

  if (cache === null) {
    if (lastSeenIdx === 0) {
      const latest = recent[0];
      const contents = telegramEscape(cleanHtml(latest.contents));
      const message =
        `✅ <b>주여닝 공지 알림 셋업 완료</b>\n` +
        `앞으로 새 공지가 올라오면 자동으로 알려드립니다.\n\n` +
        `<b>현재 최신 공지 (참고)</b>\n${contents}\n\n` +
        `<i>작성: ${latest.insertDateTime}</i>`;
      await sendNoticeWithImage(env, message, latest.imgMainSrc || "");
      await saveRecentCache(env, recent);
      await env.NOTICE_STATE.put("last_seen_idx", String(maxIdx));
      console.log("Setup notification sent");
    } else {
      await saveRecentCache(env, recent);
      console.log("Migrated: recent_notices cache populated silently");
    }
    return;
  }

  const cacheByIdx = new Map(cache.map((c) => [c.idx, c]));
  const newOnes = [];
  const editedOnes = [];

  for (const n of recent) {
    const cached = cacheByIdx.get(n.idx);
    if (!cached) {
      newOnes.push(n);
    } else if (
      cached.contents !== n.contents ||
      (cached.imgMainSrc || "") !== (n.imgMainSrc || "")
    ) {
      editedOnes.push(n);
    }
  }

  if (newOnes.length === 0 && editedOnes.length === 0) {
    console.log("No new or edited notices");
    return;
  }

  newOnes.sort((a, b) => a.idx - b.idx);
  editedOnes.sort((a, b) => a.idx - b.idx);

  for (const n of newOnes) {
    await sendNoticeWithImage(env, buildNewMessage(n), n.imgMainSrc || "");
    console.log(`New notice sent: idx ${n.idx}`);
  }
  for (const n of editedOnes) {
    await sendNoticeWithImage(env, buildEditMessage(n), n.imgMainSrc || "");
    console.log(`Edit notice sent: idx ${n.idx}`);
  }

  await saveRecentCache(env, recent);
  await env.NOTICE_STATE.put("last_seen_idx", String(maxIdx));
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      run(env).catch((err) => {
        console.error("Run failed:", err);
        return notifyError(env, err);
      })
    );
  },
  async fetch(request, env, ctx) {
    try {
      await run(env);
      return new Response("OK", { status: 200 });
    } catch (err) {
      ctx.waitUntil(notifyError(env, err));
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};
