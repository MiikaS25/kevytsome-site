/*
 * Koukuton – LinkedIn rules (www.linkedin.com, the mobile web version).
 * Injected at document start after common.js.
 *
 * Observed 2026-11-09 on a logged-in page: the feed scrolls inside
 * main#workspace. A post is [role="listitem"] with componentkey="update-card-…".
 * Other useful marks are data-view-name values: feed-full-update, feed-header-text
 * ("X likes this" above the post), large-single-video-view,
 * navigation-notifications. Hiding a post on the page doesn't move the list
 * (0 jumps in 200 scroll steps), so unlike Facebook no data filter is needed.
 * The page's data comes as a binary stream, so there is nothing to filter anyway.
 */
(function () {
  'use strict';

  var rules = window.koukutonRules;
  var SETTINGS = Object.assign({
    hideVideos: true,
    onlyNetwork: false,
    hideFeed: false,
    caughtUp: true
  }, (window.koukutonSettings || {}).linkedin || {});

  var POST_SELECTOR = '[role="listitem"][componentkey^="update-card"]';
  var ACTIVITY_HEADER = '[data-view-name="feed-header-text"], [data-view-name="feed-header-actor-image"]';
  var VIDEO_SELECTOR = 'video, [data-view-name="large-single-video-view"], [data-view-name^="media-video"], [aria-label="Video Player"]';
  // Premium ads and suggested people on the Network page; its sections have
  // different names from one load to the next, so also by what they hold.
  var HOOK_BLOCKS = '[data-view-name="premium-upsell-card"], [data-view-name^="cohorts-section"]';
  var HOOK_SECTION_CONTENT = '[data-view-name="cohort-card"], a[href*="/games/"]';
  var FEED_END_ATTR = 'data-koukuton-feed-end';
  var END_MESSAGE_ATTR = 'data-koukuton-end-message';
  var FEED_ENDED_ATTR = 'data-koukuton-feed-ended';
  var FEED_POST_LIMIT = 30;
  // Most posts can be hidden and the pages are big, so don't load forever either.
  var FEED_LOADED_LIMIT = 60;
  var HEADER_TEXT_COUNT = 10;
  var PAGINATION_PATH = '/rsc-action/actions/pagination';

  var PROMOTED_LABELS = ['promoted', 'sponsored', 'mainostettu', 'sponsoroitu', 'mainos'];
  var SUGGESTED_LABELS = ['suggested', 'ehdotettu', 'recommended for you', 'sinulle suositeltu'];
  var FOLLOW_LABELS = ['follow', 'seuraa'];
  var OWN_NETWORK = /^•\s*(1st|1\.|following|seurataan)/;
  var OUTSIDE_NETWORK = /^•\s*(2nd|3rd\+?|2\.|3\.\+?)/;

  // Keep in sync with Site.blockedPathFragments.
  var LOGIN_ELSEWHERE = ['kirjaudu apple-tunnuksilla', 'sign in with apple',
    'kirjaudu todentamisavaimella', 'sign in with a passkey'];
  var JOIN_PANEL_TITLES = ['hyväksy ja liity linkediniin', 'agree & join linkedin'];

  function isBlocked(url) {
    if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return false;
    return /\/(video|feed\/videos|games)\//.test(url.pathname.toLowerCase() + '/');
  }

  function isFeed() {
    return location.pathname.indexOf('/feed') === 0 && location.pathname.indexOf('/feed/update') !== 0;
  }

  // Short pieces of text in the order they appear.
  function shortTexts(post) {
    var texts = [];
    var walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var text = walker.currentNode.nodeValue.trim().toLowerCase();
      if (text && text.length < 40) texts.push(text);
    }
    return texts;
  }

  function isOutsideNetwork(post, texts) {
    // "Tuomas likes this", "Followed by…", "reposted this" above someone else's post.
    if (post.querySelector(ACTIVITY_HEADER)) return true;
    var header = texts.slice(0, HEADER_TEXT_COUNT);
    if (header.some(function (text) { return OWN_NETWORK.test(text); })) return false;
    return header.some(function (text) {
      return OUTSIDE_NETWORK.test(text) || FOLLOW_LABELS.indexOf(text) !== -1;
    });
  }

  function isUnwanted(post) {
    if (SETTINGS.hideFeed) return true;
    var texts = shortTexts(post);
    if (texts.some(function (text) { return PROMOTED_LABELS.indexOf(text) !== -1; })) return true;
    if (texts.slice(0, HEADER_TEXT_COUNT).some(function (text) { return SUGGESTED_LABELS.indexOf(text) !== -1; })) return true;
    if (SETTINGS.hideVideos && post.querySelector(VIDEO_SELECTOR)) return true;
    return SETTINGS.onlyNetwork && isOutsideNetwork(post, texts);
  }

  function filterPost(post) {
    if (!post.hasAttribute(rules.HIDDEN_ATTR) && isUnwanted(post)) rules.hide(post);
  }

  // "Use the LinkedIn app": the fixed bar around its link.
  function hideAppBar(root) {
    rules.within(root, 'a[href*="linkedinmobileapp.com"]').forEach(function (link) {
      for (var el = link; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).position === 'fixed') {
          el.setAttribute(rules.HIDDEN_ATTR, '');
          return;
        }
      }
      rules.hide(link);
    });
  }

  // The login page (observed 2026-11-09). Google's, Apple's and passkey sign-in
  // can't finish inside the app, and Google's One Tap panel with LinkedIn's
  // "Agree & Join" panel cover the email field, so only email + password stays.
  function isLoginPage() {
    return /^\/(login|uas\/login)/.test(location.pathname);
  }

  function hideFixedAround(el) {
    for (var parent = el; parent && parent !== document.body; parent = parent.parentElement) {
      if (getComputedStyle(parent).position === 'fixed') {
        parent.setAttribute(rules.HIDDEN_ATTR, '');
        return;
      }
    }
  }

  function simplifyLogin(root) {
    rules.within(root, 'button').forEach(function (button) {
      if (LOGIN_ELSEWHERE.indexOf(rules.textOf(button)) !== -1) rules.hide(button);
    });
    rules.within(root, 'iframe[title*="Google"]').forEach(function (frame) {
      rules.hide(frame.closest('[role="button"]') || frame);
    });
    rules.within(root, 'hr[role="presentation"]').forEach(function (line) {
      if (line.parentElement) rules.hide(line.parentElement);
    });
    rules.labelsIn(root, JOIN_PANEL_TITLES).forEach(hideFixedAround);
  }

  // "Notifications, 2 new notifications"
  function reportNotifications() {
    var link = document.querySelector('[data-view-name="navigation-notifications"]');
    var match = link && (link.getAttribute('aria-label') || '').match(/(\d+)/);
    if (link) rules.reportBadge(match ? Number(match[1]) : 0);
  }

  // ---------------------------------------------------------------------------
  // "Olet ajan tasalla": the feed has no end of its own, so it ends after a number
  // of posts. The message goes right after the list.
  // ---------------------------------------------------------------------------

  var END_TEXTS = {
    caughtUp: ['Olet ajan tasalla', 'Tässä oli tältä erää. Mitään ei jäänyt näkemättä.'],
    quietNetwork: ['Verkostossasi on hiljaista', 'Kontakteiltasi ei ole uutta. Asetuksista saat näkyviin muidenkin julkaisut.'],
    feedHidden: ['Syöte on piilotettu', 'Viestit, verkosto ja työpaikat ovat edelleen käytössä.']
  };

  function findFeedEnd(posts, shown) {
    var existing = document.querySelector('[' + FEED_END_ATTR + ']');
    if (existing) return existing;
    if (SETTINGS.hideFeed) return posts[0];
    if (shown[FEED_POST_LIMIT - 1]) return shown[FEED_POST_LIMIT - 1];
    return posts.length >= FEED_LOADED_LIMIT ? posts[posts.length - 1] : null;
  }

  // rules.hide also hides wrappers that hold nothing else, and the message must
  // not end up inside one of them.
  function outermostHidden(el) {
    var outermost = el;
    for (var parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.hasAttribute(rules.HIDDEN_ATTR)) outermost = parent;
    }
    return outermost;
  }

  // Hidden posts take no room, so the list always thinks it is near its end and
  // keeps asking for more (about 2 MB a page). After the end its requests stay
  // unanswered, so it waits instead of starting new ones.
  var feedEnded = false;
  var originalFetch = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (feedEnded && url.indexOf(PAGINATION_PATH) !== -1) return new Promise(function () {});
    return originalFetch.apply(this, arguments);
  };

  function updateFeedEnd() {
    var wanted = SETTINGS.hideFeed || SETTINGS.caughtUp;
    var posts = wanted && isFeed() ? Array.prototype.slice.call(document.querySelectorAll(POST_SELECTOR)) : [];
    var shown = posts.filter(function (post) { return !post.hasAttribute(rules.HIDDEN_ATTR); });
    var end = posts.length ? findFeedEnd(posts, shown) : null;
    var message = document.querySelector('[' + END_MESSAGE_ATTR + ']');
    feedEnded = Boolean(end);
    document.documentElement.toggleAttribute(FEED_ENDED_ATTR, feedEnded);
    if (!end) {
      if (message) message.remove();
      return;
    }
    end.setAttribute(FEED_END_ATTR, '');
    posts.slice(posts.indexOf(end) + 1).forEach(rules.hide);
    if (!message) {
      var kind = SETTINGS.hideFeed ? 'feedHidden' : shown.length ? 'caughtUp' : 'quietNetwork';
      message = document.createElement('div');
      message.setAttribute(END_MESSAGE_ATTR, '');
      var title = document.createElement('h2');
      title.textContent = END_TEXTS[kind][0];
      var body = document.createElement('p');
      body.textContent = END_TEXTS[kind][1];
      message.appendChild(title);
      message.appendChild(body);
    }
    var last = outermostHidden(posts[posts.length - 1]);
    if (last.nextElementSibling !== message) last.after(message);
  }

  rules.start({
    homeUrl: '/feed/',
    isBlocked: isBlocked,
    canSwipeBack: function () { return !isFeed(); },
    afterRules: function () {
      reportNotifications();
      updateFeedEnd();
    },
    rules: function (root) {
      hideAppBar(root);
      if (isLoginPage()) simplifyLogin(root);
      rules.within(root, HOOK_BLOCKS).forEach(rules.hide);
      rules.within(root, HOOK_SECTION_CONTENT).forEach(function (el) {
        rules.hide(el.closest('section') || el);
      });
      if (!isFeed()) return;
      // Whatever is added inside a post can change the answer ("Promoted", a video).
      var parentPost = root.closest(POST_SELECTOR);
      if (parentPost) filterPost(parentPost);
      rules.within(root, POST_SELECTOR).forEach(filterPost);
    }
  });
})();
