// "Ask us": a button at the bottom of the page that opens a chat, answered by AI from what the
// business has written down and the live price list (worker/index.js, /api/ask). Shown only
// once the site says it's on. Questions to tap to start; links in answers to the parts of the
// site they're about. The conversation goes from page to page in this tab (sessionStorage),
// and nowhere else.
(() => {
  const T = {
    open: "Ask us",
    title: "Ask Paradise Sea Express",
    close: "Close",
    hello: "Hi! Ask me anything about our boat rides: fares, stops, times, charters or fishing tours.",
    suggestions: ["How much to Pigs Beach?", "What time do boats run?", "How do I pay?", "Can I book a private charter?"],
    note: "Answers are by AI and can be wrong. Questions it can't answer are passed to our team. To book or for anything urgent, use the booking form or call +1 (242) 535-7430.",
    placeholder: "Your question",
    send: "Send",
    thinking: "Thinking…",
    offline: "Couldn't reach us just now. Check your connection, or call +1 (242) 535-7430.",
    failed: "Couldn't answer that just now. Try again in a minute.",
    you: "You",
    bot: "Paradise Sea Express",
  };
  const MOST_QUESTION = 500;
  const MOST_KEPT = 30; // messages kept from page to page
  const KEY = "pse-chat";
  // Where an answer may link (the worker tells Claude the same): anything else that looks like
  // a link is shown as plain text.
  const PAGES = /^\/(?:#[a-z]+|boat-to\/[a-z0-9-]+\/)$/;

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.append(...children);
    return node;
  };

  const load = () => {
    try {
      const kept = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      if (kept && Array.isArray(kept.history)) return kept;
    } catch {}
    return { history: [], open: false };
  };
  const state = load();
  const keep = () => {
    try {
      state.history = state.history.slice(-MOST_KEPT);
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };

  // An answer as the page shows it: **bold**, and [words](/#part) links to the site's own pages.
  function rich(text) {
    const parts = [];
    let at = 0;
    for (const m of text.matchAll(/\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
      parts.push(text.slice(at, m.index));
      if (m[1] !== undefined) parts.push(el("strong", {}, m[1]));
      else if (PAGES.test(m[3])) parts.push(el("a", { href: m[3] }, m[2]));
      else parts.push(m[2]);
      at = m.index + m[0].length;
    }
    parts.push(text.slice(at));
    return parts;
  }

  async function start() {
    try {
      const res = await fetch("/api/ask");
      if (!res.ok || !(await res.json()).available) return;
    } catch {
      return;
    }
    const icon = '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>';
    const opener = el("button", { type: "button", class: "chat-open", "aria-expanded": "false", "aria-controls": "chat-panel" });
    opener.innerHTML = `${icon}<span>${T.open}</span>`;
    const closer = el("button", { type: "button", class: "chat-close", "aria-label": T.close }, "×");
    const log = el("div", { class: "chat-log", role: "log", "aria-live": "polite" });
    const input = el("textarea", { class: "chat-input", rows: "1", maxlength: String(MOST_QUESTION), placeholder: T.placeholder, "aria-label": T.placeholder });
    const send = el("button", { type: "submit", class: "btn btn-primary chat-send" }, T.send);
    const form = el("form", { class: "chat-form" }, input, send);
    const panel = el(
      "div",
      { class: "chat-panel", id: "chat-panel", role: "dialog", "aria-label": T.title, hidden: "" },
      el("div", { class: "chat-head" }, el("img", { src: "/images/logo-mark-96.png", width: "36", height: "36", alt: "" }), el("div", {}, el("h2", {}, T.title), el("p", {}, "Usually answers in seconds")), closer),
      log,
      el("p", { class: "chat-note" }, T.note),
      form,
    );
    const scroll = () => (log.scrollTop = log.scrollHeight);
    const say = (who, text, kind = "") => {
      const line = el("div", { class: `chat-msg ${who}${kind ? ` ${kind}` : ""}` }, el("span", { class: "chat-who" }, who === "user" ? T.you : T.bot), el("p", {}, ...(who === "assistant" && !kind ? rich(text) : [text])));
      log.append(line);
      scroll();
      return line;
    };

    const suggestions = el("div", { class: "chat-suggestions" }, ...T.suggestions.map((q) => el("button", { type: "button", class: "chat-suggestion" }, q)));
    suggestions.addEventListener("click", (e) => {
      const q = e.target.closest(".chat-suggestion")?.textContent;
      if (q) ask(q);
    });

    say("assistant", T.hello);
    if (state.history.length) for (const m of state.history) say(m.role, m.text);
    else log.append(suggestions);

    const show = (open, focus = true) => {
      panel.hidden = !open;
      opener.hidden = open;
      opener.setAttribute("aria-expanded", String(open));
      state.open = open;
      keep();
      if (focus) (open ? input : opener).focus();
      if (open) scroll();
    };
    opener.addEventListener("click", () => show(true));
    closer.addEventListener("click", () => show(false));
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") show(false);
    });
    // A link in an answer to this page: on a phone the chat covers the page, so step aside.
    log.addEventListener("click", (e) => {
      if (e.target.closest("a") && matchMedia("(max-width: 600px)").matches) show(false, false);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (question) ask(question);
    });

    async function ask(question) {
      if (send.disabled) return;
      input.value = "";
      suggestions.remove();
      say("user", question);
      const waiting = say("assistant", T.thinking, "waiting");
      send.disabled = true;
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, history: state.history }),
        });
        const body = await res.json().catch(() => ({}));
        waiting.remove();
        if (res.ok && body.answer) {
          say("assistant", body.answer);
          state.history.push({ role: "user", text: question }, { role: "assistant", text: body.answer });
          keep();
        } else {
          say("assistant", body.error ?? T.failed, "error");
        }
      } catch {
        waiting.remove();
        say("assistant", T.offline, "error");
      } finally {
        send.disabled = false;
        input.focus();
      }
    }

    document.body.append(opener, panel);
    document.body.classList.add("has-chat");
    show(state.open, false);
  }

  start();
})();
