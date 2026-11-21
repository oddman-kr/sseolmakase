(function () {
  "use strict";
  var C = window.SSEOL_CONFIG;
  var KEY = "sseol_tiktok_token";
  var STATE_KEY = "sseol_oauth_state";

  function $(id) { return document.getElementById(id); }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function api(action, extra) {
    var body = Object.assign({ action: action }, extra || {});
    return fetch(C.functionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  function storeToken(d) {
    var now = Date.now();
    var t = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      open_id: d.open_id,
      scope: d.scope,
      expires_at: now + (d.expires_in || 0) * 1000,
      refresh_expires_at: now + (d.refresh_expires_in || 0) * 1000
    };
    save(KEY, t);
    return t;
  }

  function validToken() {
    var t = load(KEY);
    if (!t) return Promise.resolve(null);
    if (Date.now() < t.expires_at - 60000) return Promise.resolve(t);
    if (Date.now() >= t.refresh_expires_at) { save(KEY, null); return Promise.resolve(null); }
    return api("refresh", { refresh_token: t.refresh_token }).then(function (r) {
      if (r.ok && r.data.access_token) return storeToken(r.data);
      save(KEY, null); return null;
    });
  }

  // ---------- callback page ----------
  if (/callback\.html$/.test(location.pathname)) {
    var msg = $("msg");
    var q = new URLSearchParams(location.search);
    history.replaceState(null, "", location.pathname);
    if (q.get("error")) { msg.textContent = "연결이 취소되었거나 실패했습니다: " + (q.get("error_description") || q.get("error")); return; }
    var expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    if (!q.get("code") || !expected || q.get("state") !== expected) { msg.textContent = "연결 정보를 확인할 수 없습니다. 업로더에서 다시 시도해 주세요."; return; }
    msg.textContent = "TikTok 계정을 연결하는 중입니다…";
    api("exchange", { code: q.get("code") }).then(function (r) {
      if (r.ok && r.data.access_token) { storeToken(r.data); location.replace("uploader.html"); }
      else msg.textContent = "연결에 실패했습니다: " + (r.data.error_description || r.data.error || "알 수 없는 오류");
    }).catch(function () { msg.textContent = "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."; });
    return;
  }

  if (!$("app")) return;

  // ---------- uploader page ----------
  var PRIVACY_LABEL = {
    PUBLIC_TO_EVERYONE: "모든 사람",
    MUTUAL_FOLLOW_FRIENDS: "친구 (서로 팔로우)",
    FOLLOWER_OF_CREATOR: "팔로워",
    SELF_ONLY: "나만 보기"
  };
  var state = { token: null, creator: null, posts: [], post: null, page: 0, posting: false };

  function startLogin() {
    var s = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    sessionStorage.setItem(STATE_KEY, s);
    var u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", C.clientKey);
    u.searchParams.set("scope", C.scopes);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", C.redirectUri);
    u.searchParams.set("state", s);
    location.href = u.toString();
  }

  function showConnect() { $("connect").classList.remove("hidden"); $("app").classList.add("hidden"); }

  function imgUrl(post, name) { return C.mediaBase + post.id + "/" + name; }

  function renderViewer() {
    var p = state.post; if (!p) return;
    var n = p.images.length;
    $("viewImg").src = imgUrl(p, p.images[state.page]);
    $("viewImg").alt = "카드 " + (state.page + 1) + " / " + n;
    $("pageNo").textContent = (state.page + 1) + " / " + n;
    $("prevBtn").disabled = state.page === 0;
    $("nextBtn").disabled = state.page === n - 1;
    Array.prototype.forEach.call($("thumbs").children, function (el, i) { el.className = i === state.page ? "on" : ""; });
  }

  function selectPost(p) {
    state.post = p; state.page = 0;
    Array.prototype.forEach.call($("postList").children, function (b) { b.setAttribute("aria-pressed", String(b.dataset.id === p.id)); });
    $("title").value = p.title || "";
    $("desc").value = p.description || "";
    $("thumbs").innerHTML = "";
    p.images.forEach(function (name, i) {
      var im = document.createElement("img");
      im.src = imgUrl(p, name); im.alt = "카드 " + (i + 1);
      im.addEventListener("click", function () { state.page = i; renderViewer(); });
      $("thumbs").appendChild(im);
    });
    counts(); renderViewer(); refresh();
  }

  function counts() {
    $("titleCount").textContent = $("title").value.length;
    $("descCount").textContent = $("desc").value.length;
  }

  function refresh() {
    var disclose = $("disclose").checked, yours = $("yourBrand").checked, branded = $("branded").checked;
    $("discloseBox").classList.toggle("hidden", !disclose);
    if (!disclose) { $("yourBrand").checked = false; $("branded").checked = false; yours = branded = false; }

    var self = $("privacy").querySelector('option[value="SELF_ONLY"]');
    if (self) {
      self.disabled = branded;
      self.textContent = PRIVACY_LABEL.SELF_ONLY + (branded ? " (브랜디드 콘텐츠는 비공개로 게시할 수 없습니다)" : "");
      if (branded && $("privacy").value === "SELF_ONLY") $("privacy").value = "";
    }
    $("privacyHint").textContent = branded ? "브랜디드 콘텐츠는 '나만 보기'로 설정할 수 없습니다." : "";

    var label = "";
    if (branded) label = "게시물에 '유료 파트너십' 라벨이 표시됩니다.";
    else if (yours) label = "게시물에 '프로모션 콘텐츠' 라벨이 표시됩니다.";
    else if (disclose) label = "홍보 대상을 하나 이상 선택해야 게시할 수 있습니다.";
    $("labelHint").textContent = label;

    var mu = '<a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">음악 사용 확인(Music Usage Confirmation)</a>';
    var bc = '<a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">브랜디드 콘텐츠 정책(Branded Content Policy)</a>';
    $("declare").innerHTML = "게시하면 TikTok의 " + (branded ? bc + " 및 " : "") + mu + "에 동의하게 됩니다.";

    var blocked = !state.creator || state.creator.cantPost;
    $("postBtn").disabled = state.posting || blocked || !state.post || !$("privacy").value || (disclose && !yours && !branded);
  }

  function setStatus(t) { $("status").textContent = t; }

  function pollStatus(publishId, tries) {
    api("status", { access_token: state.token.access_token, publish_id: publishId }).then(function (r) {
      var d = r.data && r.data.data || {};
      var s = d.status;
      if (s === "PUBLISH_COMPLETE") { setStatus("게시가 완료되었습니다. TikTok 프로필에서 확인해 보세요."); state.posting = false; refresh(); return; }
      if (s === "FAILED") { setStatus("게시에 실패했습니다: " + (d.fail_reason || "알 수 없는 이유")); state.posting = false; refresh(); return; }
      if (tries > 40) { setStatus("TikTok에서 아직 처리 중입니다. 몇 분 뒤 프로필에서 확인해 주세요."); state.posting = false; refresh(); return; }
      setStatus("TikTok이 콘텐츠를 처리하는 중입니다 (" + (s || "대기") + "). 게시물이 프로필에 보이기까지 몇 분 걸릴 수 있습니다.");
      setTimeout(function () { pollStatus(publishId, tries + 1); }, 3000);
    });
  }

  function doPost() {
    if ($("postBtn").disabled) return;
    state.posting = true; refresh();
    setStatus("TikTok에 게시 요청을 보내는 중입니다…");
    var p = state.post;
    var body = {
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
      post_info: {
        title: $("title").value,
        description: $("desc").value,
        privacy_level: $("privacy").value,
        disable_comment: !$("allowComment").checked,
        auto_add_music: $("autoMusic").checked,
        brand_content_toggle: $("branded").checked,
        brand_organic_toggle: $("yourBrand").checked
      },
      source_info: { photo_cover_index: 0, photo_images: p.images.map(function (n) { return imgUrl(p, n); }) }
    };
    api("post_photo", { access_token: state.token.access_token, body: body }).then(function (r) {
      var err = r.data && r.data.error;
      if (!r.ok || (err && err.code && err.code !== "ok")) {
        setStatus("게시 요청이 거절되었습니다: " + ((err && (err.message || err.code)) || r.data.error || "알 수 없는 오류"));
        state.posting = false; refresh(); return;
      }
      pollStatus(r.data.data.publish_id, 0);
    }).catch(function () { setStatus("서버에 연결할 수 없습니다."); state.posting = false; refresh(); });
  }

  function loadCreator() {
    return api("creator_info", { access_token: state.token.access_token }).then(function (r) {
      var d = r.data && r.data.data || {};
      var err = r.data && r.data.error || {};
      var c = { cantPost: false };
      if (!r.ok || (err.code && err.code !== "ok")) {
        c.cantPost = true;
        var m = err.code === "spam_risk_too_many_posts" ? "오늘 게시할 수 있는 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요."
          : err.code === "spam_risk_user_banned_from_posting" ? "이 계정은 현재 게시가 제한되어 있습니다."
          : "지금은 이 계정으로 게시할 수 없습니다: " + (err.message || err.code || "알 수 없는 오류");
        $("cantPost").textContent = m; $("cantPost").classList.remove("hidden");
      }
      if (d.creator_avatar_url) $("avatar").src = d.creator_avatar_url;
      if (d.creator_nickname || d.creator_username) $("nick").textContent = (d.creator_nickname || "") + (d.creator_username ? " (@" + d.creator_username + ")" : "");
      var sel = $("privacy");
      (d.privacy_level_options || []).forEach(function (v) {
        var o = document.createElement("option"); o.value = v; o.textContent = PRIVACY_LABEL[v] || v; sel.appendChild(o);
      });
      if (d.comment_disabled) {
        $("allowComment").checked = false; $("allowComment").disabled = true;
        $("commentHint").textContent = "TikTok 계정 설정에서 댓글이 꺼져 있어 변경할 수 없습니다.";
      }
      state.creator = c;
    });
  }

  function init() {
    $("loginBtn").addEventListener("click", startLogin);
    $("logoutBtn").addEventListener("click", function () {
      var t = load(KEY);
      if (t) api("revoke", { access_token: t.access_token }).catch(function () {});
      save(KEY, null); location.reload();
    });
    $("prevBtn").addEventListener("click", function () { if (state.page > 0) { state.page--; renderViewer(); } });
    $("nextBtn").addEventListener("click", function () { if (state.post && state.page < state.post.images.length - 1) { state.page++; renderViewer(); } });
    ["title", "desc"].forEach(function (id) { $(id).addEventListener("input", counts); });
    ["privacy", "disclose", "yourBrand", "branded"].forEach(function (id) { $(id).addEventListener("change", refresh); });
    $("postBtn").addEventListener("click", doPost);

    validToken().then(function (t) {
      if (!t) { showConnect(); return; }
      state.token = t;
      $("connect").classList.add("hidden"); $("app").classList.remove("hidden");
      api("user_info", { access_token: t.access_token }).then(function (r) {
        var u = r.data && r.data.data && r.data.data.user || {};
        if (u.avatar_url && !$("avatar").src) $("avatar").src = u.avatar_url;
        if (u.display_name && $("nick").textContent === "-") $("nick").textContent = u.display_name;
      });
      return Promise.all([
        loadCreator(),
        fetch("posts/posts.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (list) {
          state.posts = list;
          list.forEach(function (p) {
            var b = document.createElement("button");
            b.type = "button"; b.dataset.id = p.id; b.setAttribute("aria-pressed", "false");
            b.textContent = "#" + p.id + " " + p.title;
            b.addEventListener("click", function () { selectPost(p); });
            $("postList").appendChild(b);
          });
          if (list[0]) selectPost(list[0]);
        })
      ]).then(refresh);
    });
  }
  init();
})();
