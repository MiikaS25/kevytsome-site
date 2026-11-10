/*
 * Koukuton – Facebook rules (m.facebook.com, the mobile web version).
 * Injected at document start after common.js.
 *
 * Observed 2026-11-09 on a logged-in page:
 *   - the page is drawn from JSON read with JSON.parse: a tree of changes
 *     { type, index, value, children } where value holds ready-made HTML. The
 *     indexes point to children of the page, so nothing may be added to or
 *     removed from the list, only changed in place.
 *   - feed = [data-pull-to-refresh-action-id] (data-type="vscroller"), its
 *     children are posts ([data-tracking-duration-id]), 1 px separators, and
 *     spacers. It is a virtualized list: it counts every post's height from
 *     the post's own data-actual-height and style.
 *
 * Hiding a post on the page would make the list jump by that post's height
 * when it scrolls out of the mounted window. So unwanted posts get height 0
 * already in the data, before the list reads it.
 */
(function () {
  'use strict';

  var rules = window.koukutonRules;
  var SETTINGS = Object.assign({
    hideVideos: true,
    hideStories: false,
    hideMarketplace: false,
    hideFeed: false,
    caughtUp: true
  }, (window.koukutonSettings || {}).facebook || {});

  var POST_SELECTOR = '[data-tracking-duration-id]';
  var LIST_SELECTOR = '[data-pull-to-refresh-action-id]';
  var FEED_END_ATTR = 'data-koukuton-feed-end';
  var END_MESSAGE_ATTR = 'data-koukuton-end-message';
  var FEED_POST_LIMIT = 30;

  var LABELS_ANYWHERE = ['sponsoroitu', 'sponsored', 'ihmisiä, jotka saatat tuntea', 'people you may know',
    'reels', 'kelat', 'kelat ja lyhyet videot', 'reels and short videos', 'sinulle ehdotettua',
    'ehdotettu sinulle', 'ehdotukset sinulle', 'suggested for you'];
  // Next to the author's name: a group or page the user hasn't joined.
  var LABELS_IN_HEADER = ['liity', 'join', 'seuraa', 'follow'];
  var HEADER_TEXT_COUNT = 8;

  // Tabs read like "reels, 4 of 6" in English even on a Finnish page. Messages
  // only lead to a "get Messenger" page in the web version.
  var SHORT_VIDEO_TABS = ['reels', 'watch', 'video', 'messages'];
  var MENU_TILES_OFF = ['kelat', 'reels', 'viestit', 'messages'];
  var GET_APP_PREFIXES = ['hanki facebook', 'get facebook'];

  // Prompts to move to the official app, and what closes them.
  var APP_PROMPT_TEXT = /parempi sovelluksessa|parempi facebook-sovelluksessa|better (in|on) the app|käytä facebook-sovellusta|avaa facebook-sovelluksessa|lataa facebook|get the facebook app|use the facebook app|open in app|avaa sovelluksessa|avaa sovellus|open app/i;
  var DISMISS_TEXTS = ['ei nyt', 'not now', 'jatka selaimessa', 'continue in browser', 'jatka', 'continue',
    'sulje', 'close', 'peruuta', 'cancel', 'ei kiitos', 'no thanks', 'myöhemmin', 'later'];

  // Keep in sync with Site.blockedPathFragments.
  function isBlocked(url) {
    if (!/(^|\.)(facebook\.com|fb\.com)$/.test(url.hostname)) return false;
    var path = url.pathname.toLowerCase() + '/';
    if (/\/(reels?|share\/r|watch\/(feed|live|latest))\//.test(path)) return true;
    // A single video from a post (/watch/?v=…) still opens, the video feed doesn't.
    return /^\/watch\/+$/.test(path) && !url.searchParams.get('v');
  }

  function isHomeFeed() {
    return location.pathname === '/' || location.pathname === '/home.php';
  }

  // Some pages open on top of the feed without changing the address. The feed
  // itself is the one with the tab bar on screen.
  function isOnFeedScreen() {
    if (!isHomeFeed()) return false;
    var tabs = document.querySelector('[role="tablist"]');
    return Boolean(tabs) && tabs.getBoundingClientRect().height > 0;
  }

  // Short pieces of text in the order they appear.
  function shortTexts(post) {
    var texts = [];
    var walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var text = walker.currentNode.nodeValue.replace(/[‎‏]/g, '').trim().toLowerCase();
      if (text && text.length < 40) texts.push(text);
    }
    return texts;
  }

  function isUnwanted(post) {
    if (SETTINGS.hideFeed && isHomeFeed()) return true;
    var texts = shortTexts(post);
    if (texts.some(function (text) { return LABELS_ANYWHERE.indexOf(text) !== -1; })) return true;
    // A friend's profile or a group's own page stays as it is.
    if (!isHomeFeed()) return false;
    if (texts.slice(0, HEADER_TEXT_COUNT).some(function (text) { return LABELS_IN_HEADER.indexOf(text) !== -1; })) return true;
    return SETTINGS.hideVideos && Boolean(post.querySelector('[data-type="video"]'));
  }

  function collapse(el) {
    el.setAttribute('data-actual-height', '0');
    el.style.height = '0px';
    el.style.margin = '0';
    el.setAttribute(rules.HIDDEN_ATTR, '');
  }

  function isSeparator(el) {
    return Boolean(el) && !el.matches(POST_SELECTOR) && el.getAttribute('data-actual-height') === '1';
  }

  function collapseUnwanted(root) {
    var changed = false;
    root.querySelectorAll(POST_SELECTOR).forEach(function (post) {
      if (post.hasAttribute(rules.HIDDEN_ATTR) || !isUnwanted(post)) return;
      collapse(post);
      if (isSeparator(post.nextElementSibling)) collapse(post.nextElementSibling);
      changed = true;
    });
    return collapseStoryRow(root) || changed;
  }

  // The row of stories, when it holds nothing but "Luo tarina" or stories are off.
  function collapseStoryRow(root) {
    var create = root.querySelector('[aria-label="Luo tarina"], [aria-label="Create story"]');
    if (!create) return false;
    // Up to the row itself: a child of the list, or the top of a piece of new HTML.
    var row = create;
    while (row.parentElement && !row.parentElement.matches(LIST_SELECTOR)) row = row.parentElement;
    if (row.hasAttribute(rules.HIDDEN_ATTR)) return false;
    var others = Array.prototype.filter.call(row.querySelectorAll('[role="button"][aria-label]'), function (el) {
      return el !== create;
    });
    if (others.length > 0 && !SETTINGS.hideStories) return false;
    collapse(row);
    return true;
  }

  // New feed posts arrive as an HTML string inside the JSON.
  function filterHtml(html) {
    if (html.indexOf('data-tracking-duration-id') === -1 && html.indexOf('Luo tarina') === -1 && html.indexOf('Create story') === -1) return html;
    var template = document.createElement('template');
    template.innerHTML = html;
    return collapseUnwanted(template.content) ? template.innerHTML : html;
  }

  function filterChanges(node) {
    if (typeof node.value === 'string') node.value = filterHtml(node.value);
    if (Array.isArray(node.children)) node.children.forEach(filterChanges);
  }

  var parse = JSON.parse;
  JSON.parse = function (text) {
    var result = parse.apply(this, arguments);
    if (typeof text === 'string' && result && Array.isArray(result.children)) {
      filterChanges(result);
    }
    return result;
  };

  // ---------------------------------------------------------------------------
  // On the page
  // ---------------------------------------------------------------------------

  function tidyTabs(root) {
    rules.within(root, '[role="tab"]').forEach(function (tab) {
      var label = (tab.getAttribute('aria-label') || '').split(',')[0].trim().toLowerCase();
      if (SHORT_VIDEO_TABS.indexOf(label) !== -1) tab.setAttribute(rules.INERT_ATTR, '');
      // "190 new" on the home tab only pulls you back in; notifications keep theirs.
      if (label === 'feed') {
        Array.prototype.forEach.call(tab.querySelectorAll('*'), function (el) {
          if (el.childElementCount === 0 && /^\d+\+?$/.test((el.textContent || '').trim())) {
            for (var badge = el; badge.parentElement !== tab; badge = badge.parentElement);
            badge.setAttribute(rules.HIDDEN_ATTR, '');
          }
        });
      }
    });
    var parentTab = root.closest('[role="tab"]');
    if (parentTab && parentTab !== root) tidyTabs(parentTab);
  }

  function hideGetAppBanner(root) {
    rules.within(root, '[role="button"][aria-label]').forEach(function (button) {
      var label = button.getAttribute('aria-label').toLowerCase();
      var isBanner = GET_APP_PREFIXES.some(function (prefix) { return label.indexOf(prefix) === 0; });
      if (isBanner) rules.hide(button.parentElement);
    });
  }

  // Menu tiles that lead to short videos, or to "get Messenger": messages don't
  // work in the web version.
  function hideMenuTiles(root) {
    if (location.pathname.indexOf('/bookmarks') !== 0) return;
    rules.labelsIn(root, MENU_TILES_OFF).forEach(function (label) {
      var tile = label.closest('[role="button"], [data-focusable="true"]');
      if (tile) tile.setAttribute('data-koukuton-tile-off', '');
    });
  }

  // A prompt to use the app: press its own "not now", or hide it if it has none.
  function closeAppPrompts(root) {
    rules.within(root, 'span, div, h1, h2, h3').forEach(function (el) {
      if (el.childElementCount > 0 || !APP_PROMPT_TEXT.test(el.textContent || '') || el.closest(POST_SELECTOR)) return;
      console.log('Koukuton: app prompt');
      for (var box = el.parentElement; box && box !== document.body; box = box.parentElement) {
        var dismiss = Array.prototype.filter.call(box.querySelectorAll('[role="button"], button, a'), function (button) {
          var label = (button.getAttribute('aria-label') || button.textContent || '').trim().toLowerCase();
          return DISMISS_TEXTS.indexOf(label) !== -1;
        })[0];
        if (dismiss) {
          dismiss.click();
          return;
        }
        var position = getComputedStyle(box).position;
        if (position === 'fixed' || position === 'absolute') {
          rules.hide(box);
          return;
        }
      }
    });
  }

  function isFullScreen(player) {
    try {
      return JSON.parse(player.getAttribute('data-extra') || 'null').player_format === 'full_screen';
    } catch (e) {
      return false;
    }
  }

  // Reels also open at /<profile>/videos/…, so the player itself tells them.
  function stopReels(root) {
    rules.within(root, '[data-type="video"][data-is-reels="true"]').forEach(function (player) {
      if (!isFullScreen(player)) return;
      player.querySelectorAll('video').forEach(function (video) { video.pause(); });
      rules.goHome('/');
    });
  }

  // ---------------------------------------------------------------------------
  // "Olet ajan tasalla": Facebook's feed has no end of its own and isn't in time
  // order, so it ends after a number of posts. The message can't go in the list
  // (see the top of this file), so it comes right after the page.
  // ---------------------------------------------------------------------------

  var END_TEXTS = {
    caughtUp: ['Olet ajan tasalla', 'Tässä oli tältä erää. Vedä alas, jos haluat katsoa uudet julkaisut.'],
    feedHidden: ['Syöte on piilotettu', 'Ryhmät, viestit ja ilmoitukset ovat edelleen käytössä.']
  };

  // "notifications, 51 new, 5 of 6" → 51; no "new" means none.
  function reportNotifications() {
    var tab = document.querySelector('[role="tab"][aria-label^="notifications"]');
    if (!tab) return;
    var match = tab.getAttribute('aria-label').match(/(\d+) new/);
    rules.reportBadge(match ? Number(match[1]) : 0);
  }

  // The page itself is gray; this is the white (or dark) of the things on it, for
  // the places left bare by what was removed.
  function rememberSurfaceColor(bar) {
    var inner = bar.querySelectorAll('*');
    for (var i = 0; i < inner.length; i++) {
      var color = getComputedStyle(inner[i]).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)') {
        document.documentElement.style.setProperty('--koukuton-surface', color);
        return;
      }
    }
  }

  // Tabs sit side by side through their inline margins.
  function spreadTabs() {
    document.querySelectorAll('[role="tablist"]').forEach(function (bar) {
      var tabs = Array.prototype.filter.call(bar.children, function (child) {
        return child.getAttribute('role') === 'tab' && getComputedStyle(child).display !== 'none';
      });
      if (!tabs.length) return;
      rememberSurfaceColor(bar);
      var slot = bar.clientWidth / tabs.length;
      tabs.forEach(function (tab, i) {
        var marginLeft = Math.round((i + 0.5) * slot - tab.offsetWidth / 2) + 'px';
        if (tab.style.marginLeft !== marginLeft) tab.style.marginLeft = marginLeft;
      });
    });
  }

  function updateFeedEnd() {
    spreadTabs();
    reportNotifications();
    var list = isHomeFeed() ? document.querySelector(LIST_SELECTOR) : null;
    var message = document.querySelector('[' + END_MESSAGE_ATTR + ']');
    var kind = SETTINGS.hideFeed ? 'feedHidden' : SETTINGS.caughtUp ? 'caughtUp' : null;
    var end = list && kind ? findFeedEnd(list) : null;
    if (!end) {
      if (message) message.remove();
      return;
    }
    if (!end.hasAttribute(FEED_END_ATTR)) end.setAttribute(FEED_END_ATTR, '');
    if (!message) {
      message = document.createElement('div');
      message.setAttribute(END_MESSAGE_ATTR, '');
      var title = document.createElement('h2');
      title.textContent = END_TEXTS[kind][0];
      var body = document.createElement('p');
      body.textContent = END_TEXTS[kind][1];
      message.appendChild(title);
      message.appendChild(body);
    }
    var host = document.getElementById('screen-root') || document.body;
    if (host.lastElementChild !== message) host.appendChild(message);
  }

  function findFeedEnd(list) {
    var existing = list.querySelector(':scope > [' + FEED_END_ATTR + ']');
    if (existing) return existing;
    var posts = list.querySelectorAll(':scope > ' + POST_SELECTOR);
    if (SETTINGS.hideFeed) return posts[0] || null;
    var shown = Array.prototype.filter.call(posts, function (post) {
      return !post.hasAttribute(rules.HIDDEN_ATTR);
    });
    return shown[FEED_POST_LIMIT - 1] || null;
  }

  if (SETTINGS.hideMarketplace) document.documentElement.setAttribute('data-koukuton-hide-marketplace', '');

  rules.start({
    homeUrl: '/',
    isBlocked: isBlocked,
    canSwipeBack: function () { return !isOnFeedScreen(); },
    afterRules: updateFeedEnd,
    rules: function (root) {
      hideGetAppBanner(root);
      tidyTabs(root);
      hideMenuTiles(root);
      closeAppPrompts(root);
      stopReels(root);
      // Whatever got past the data filter.
      if (root.matches(POST_SELECTOR)) {
        if (!root.hasAttribute(rules.HIDDEN_ATTR) && isUnwanted(root)) collapse(root);
      } else {
        collapseUnwanted(root);
      }
    }
  });
})();
