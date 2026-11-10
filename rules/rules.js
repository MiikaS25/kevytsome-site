/*
 * Koukuton – hiding rules (JavaScript)
 * Injected at document end into every Instagram page.
 *
 * Elements to hide are marked with the data-koukuton-hidden attribute;
 * rules.css does the actual hiding. A MutationObserver re-runs the rules
 * whenever Instagram adds content (it renders the page with JavaScript).
 *
 * The user's settings arrive as window.koukutonSettings (set by
 * RuleInjector.swift before this file runs).
 *
 * Use stable signals only (href, aria-label / visible text in Finnish +
 * English, role, data-pagelet) – never Instagram's random class names.
 * All text lists are lower-case; compare with textOf().
 */
(function () {
  'use strict';

  var SETTINGS = Object.assign({
    hideStories: false,
    hideFeed: false,
    messagesOnly: false,
    hideComments: false,
    hideReposts: true,
    hideFeedVideos: true,
    hideSearch: false,
    caughtUp: true
  }, window.koukutonSettings || {});

  var HIDDEN_ATTR = 'data-koukuton-hidden';
  var COLLAPSED_ATTR = 'data-koukuton-collapsed'; // post squeezed to 1 px, see hideUnwantedPosts
  var INERT_ATTR = 'data-koukuton-inert';
  var UNWANTED_ATTR = 'data-koukuton-unwanted';   // post hidden by a content rule
  var OBSERVED_ATTR = 'data-koukuton-observed';   // post watched for "seen"
  var CAUGHT_UP_ATTR = 'data-koukuton-caught-up'; // our end-of-feed message
  var BACK_COVER_ATTR = 'data-koukuton-back-cover';  // messages-only inbox
  var LOGIN_ROW_ATTR = 'data-koukuton-login-row';
  var PRIMARY_LOGIN_ATTR = 'data-koukuton-primary-login';
  var SEARCH_TAB_BAR_ATTR = 'data-koukuton-search-tab-bar';
  var REEL_BACK_ATTR = 'data-koukuton-reel-back';     // "Palaa keskusteluun"
  var REEL_FILL_ATTR = 'data-koukuton-reel-fill';     // reel box stretched to full width

  // ---------------------------------------------------------------------------
  // Texts and paths
  // ---------------------------------------------------------------------------

  // Paths that must never open. Instagram changes pages without reloading,
  // so the Swift-side block alone is not enough – these are also checked here.
  // /explore/ itself is also the search page, so it is only blocked when
  // search is turned off. Keep the always-blocked list in sync with AppConfig.swift.
  var BLOCKED_PATH_FRAGMENTS = ['/reels/', '/reel/', '/explore/tags/', '/explore/locations/']
    .concat(SETTINGS.hideSearch || SETTINGS.messagesOnly ? ['/explore/'] : [])
    .concat(SETTINGS.hideStories ? ['/stories/'] : [])
    .concat(SETTINGS.hideComments ? ['/comments/'] : []);

  // Hashtag and place links inside captions stay as text but can't be tapped.
  var INERT_PATH_FRAGMENTS = ['/explore/tags/', '/explore/locations/'];

  // Home shows only accounts the user follows – or the inbox in messages-only mode.
  var HOME_URL = SETTINGS.messagesOnly ? '/direct/inbox/' : '/?variant=following';

  // Buttons that send the user to the official Instagram app.
  var OPEN_APP_TEXTS = ['avaa instagram', 'open instagram', 'käytä sovellusta', 'use the app', 'use app'];
  var CLOSE_LABELS = ['Sulje', 'Close'];
  var BACK_LABELS = ['Takaisin', 'Back'];
  var COMMENT_LABELS = ['Kommentoi', 'Comment'];
  var REPOSTED_LABELS = ['Julkaistu uudelleen', 'Reposted'];
  var CANCEL_TEXTS = ['peruuta', 'cancel'];

  // Landing page "Log in or sign up" row.
  var LOGIN_TEXTS = ['kirjaudu sisään', 'log in'];
  var SIGNUP_TEXTS = ['rekisteröidy', 'sign up'];

  // Feed posts carrying one of these labels are hidden.
  var SUGGESTED_POST_TEXTS = ['sinulle ehdotettua', 'suggested for you'];
  var SPONSORED_TEXTS = ['sponsoroitu', 'sponsored'];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function textOf(el) {
    return (el.textContent || '').trim().toLowerCase();
  }

  function pathMatches(path, fragments) {
    var p = (path || '').toLowerCase() + '/';
    return fragments.some(function (fragment) {
      return p.indexOf(fragment) !== -1;
    });
  }

  function isBlockedPath(path) {
    return pathMatches(path, BLOCKED_PATH_FRAGMENTS);
  }

  function isReelPath(path) {
    return /\/reels?\//.test((path || '') + '/');
  }

  // A friend's reel sent in a DM may be opened from the conversation – but
  // nothing else: no Reels feed, no swiping on to the next reel.
  function isAllowedFromHere(path) {
    return location.pathname.indexOf('/direct/') === 0 && /\/reel\/[^/]+\/?$/.test(path) &&
      !pathMatches(path, ['/reels/']);
  }

  function isBlockedNavigation(path) {
    return isBlockedPath(path) && !isAllowedFromHere(path);
  }

  // Home ("/") must always lead to HOME_URL.
  function needsHomeRedirect(url) {
    if (url.pathname !== '/') return false;
    return SETTINGS.messagesOnly || url.searchParams.get('variant') !== 'following';
  }

  function hide(el) {
    if (el.hasAttribute(HIDDEN_ATTR)) return;
    el.setAttribute(HIDDEN_ATTR, '');
    // Also hide wrappers that hold nothing else, so no empty gap is left.
    var parent = el.parentElement;
    while (parent && parent.childElementCount === 1 &&
           parent !== document.body && parent.tagName !== 'MAIN') {
      parent.setAttribute(HIDDEN_ATTR, '');
      parent = parent.parentElement;
    }
  }

  function hasExactText(root, selector, texts) {
    return Array.prototype.some.call(root.querySelectorAll(selector), function (el) {
      return texts.indexOf(textOf(el)) !== -1;
    });
  }

  function hasIcon(root, labels) {
    return labels.some(function (label) {
      return root.querySelector('svg[aria-label="' + label + '"]');
    });
  }

  function isHomeFeed() {
    return location.pathname === '/' && !SETTINGS.messagesOnly;
  }

  // ---------------------------------------------------------------------------
  // Navigation: block Reels & co, keep Home on the following feed
  // ---------------------------------------------------------------------------

  // Guards against a reload loop if Instagram ever stops honouring the URL.
  function redirectHome() {
    try {
      var last = Number(sessionStorage.getItem('koukuton-redirect') || 0);
      if (Date.now() - last < 5000) return;
      sessionStorage.setItem('koukuton-redirect', String(Date.now()));
    } catch (e) {}
    location.replace(HOME_URL);
  }

  if (isBlockedPath(location.pathname) || needsHomeRedirect(new URL(location.href))) {
    redirectHome();
  }

  // Taps: our back-arrow cover, then links – swallow blocked ones, send Home
  // to HOME_URL. Capture phase on document runs before Instagram's handlers.
  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[' + BACK_COVER_ATTR + ']')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    var reelBack = event.target.closest && event.target.closest('[' + REEL_BACK_ATTR + ']');
    if (reelBack) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeReelViewer(reelBack);
      return;
    }
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    var url = new URL(link.getAttribute('href'), location.href);
    if (url.origin !== location.origin) return;
    if (isBlockedNavigation(url.pathname)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      console.log('Koukuton: blocked link ' + url.pathname);
    } else if (needsHomeRedirect(url)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      location.assign(HOME_URL);
    }
  }, true);

  // In-app page changes that don't come from a link tap.
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function (state, title, url) {
      if (url != null) {
        var target = new URL(url, location.href);
        if (isBlockedNavigation(target.pathname)) {
          console.log('Koukuton: blocked ' + name + ' ' + target.pathname);
          // On a friend's reel, swiping on simply doesn't go anywhere.
          if (!isReelPath(location.pathname)) redirectHome();
          return;
        }
        if (needsHomeRedirect(target)) {
          redirectHome();
          return;
        }
      }
      return original.apply(this, arguments);
    };
  });

  window.addEventListener('popstate', function () {
    if (isBlockedPath(location.pathname) || needsHomeRedirect(new URL(location.href))) redirectHome();
  });

  // ---------------------------------------------------------------------------
  // Hiding rules
  // ---------------------------------------------------------------------------

  // Tabs and links to blocked places (Reels tab, reels in profile grids,
  // Search tab when search is off, highlights when stories are off…).
  function hideBlockedLinks() {
    var onDirect = location.pathname.indexOf('/direct/') === 0;
    document.querySelectorAll('a[href^="/"]:not([' + HIDDEN_ATTR + ']):not([' + INERT_ATTR + '])').forEach(function (link) {
      var path = link.getAttribute('href').split(/[?#]/)[0];
      if (pathMatches(path, INERT_PATH_FRAGMENTS)) {
        link.setAttribute(INERT_ATTR, '');
      } else if (onDirect && isReelPath(path)) {
        return;
      } else if (isBlockedPath(path) || (SETTINGS.messagesOnly && path === '/')) {
        hide(link);
      }
    });
  }

  // "Avaa Instagram" on the landing page, "Käytä sovellusta" banner in the app.
  function hideOpenAppButtons() {
    document.querySelectorAll('button, [role="button"]').forEach(function (el) {
      if (OPEN_APP_TEXTS.indexOf(textOf(el)) === -1) return;
      // A banner has its own close (X) button next to it – hide the whole banner.
      var banner = el.parentElement;
      for (var i = 0; banner && i < 4; i++, banner = banner.parentElement) {
        if (hasIcon(banner, CLOSE_LABELS)) {
          hide(banner);
          return;
        }
      }
      hide(el);
    });
  }

  function hideStories() {
    if (!SETTINGS.hideStories) return;
    document.querySelectorAll('[data-pagelet="story_tray"]').forEach(hide);
  }

  // Home feed: suggested posts, ads, reposts, Reels and video posts. feed.js
  // already takes these out of the feed's data; this catches what gets through
  // (e.g. if Instagram changes its data). The feed is a virtualized list that
  // stops working with a post on display:none, so they stay in the layout,
  // squeezed to 1 px (rules.css).
  function hideUnwantedPosts() {
    if (!isHomeFeed()) return;
    document.querySelectorAll('article:not([' + UNWANTED_ATTR + '])').forEach(function (post) {
      var unwanted =
        window.koukutonFeedEmpty ||
        hasExactText(post, 'span', SUGGESTED_POST_TEXTS) ||
        hasExactText(post, 'span', SPONSORED_TEXTS) ||
        post.querySelector('a[href*="facebook.com/ads/"]') ||
        (SETTINGS.hideReposts && hasIcon(post, REPOSTED_LABELS)) ||
        (SETTINGS.hideFeedVideos && (post.querySelector('a[href*="/reel/"]') || post.querySelector('video')));
      if (unwanted) {
        post.setAttribute(UNWANTED_ATTR, '');
        post.setAttribute(COLLAPSED_ATTR, '');
      }
    });
  }

  // Comment buttons and counts, "view all comments" links, comment boxes.
  function hideComments() {
    if (!SETTINGS.hideComments) return;
    COMMENT_LABELS.forEach(function (label) {
      document.querySelectorAll('svg[aria-label="' + label + '"]').forEach(function (icon) {
        var button = icon.closest('[role="button"]');
        if (!button || button.hasAttribute(HIDDEN_ATTR)) return;
        hide(button);
        // The comment count sits right after the button's wrapper.
        var wrapper = button;
        while (wrapper.parentElement && wrapper.parentElement.hasAttribute(HIDDEN_ATTR)) wrapper = wrapper.parentElement;
        var count = wrapper.nextElementSibling;
        if (count && count.getAttribute('role') === 'button' && /^\d/.test(textOf(count))) hide(count);
      });
    });
    document.querySelectorAll('textarea, input[type="text"]').forEach(function (field) {
      var hint = (field.getAttribute('placeholder') || '') + ' ' + (field.getAttribute('aria-label') || '');
      if (/kommentti|comment/i.test(hint)) hide(field.closest('form') || field);
    });
  }

  // Home header reads "< Seurataan" and links back to the "For you" feed:
  // drop the arrow and make the title non-tappable.
  function lockFollowingFeedHeader() {
    if (!isHomeFeed()) return;
    document.querySelectorAll('header a[href="/"]').forEach(function (link) {
      BACK_LABELS.forEach(function (label) {
        link.querySelectorAll('svg[aria-label="' + label + '"]').forEach(function (svg) {
          svg.parentElement.setAttribute(HIDDEN_ATTR, '');
        });
      });
      link.setAttribute(INERT_ATTR, '');
    });
  }

  // Search page (/explore/): keep the search box and results, hide the
  // discovery grid of posts and Reels from strangers.
  function hideExploreGrid() {
    if (location.pathname !== '/explore/') return;
    var main = document.querySelector('main');
    if (!main) return;
    Array.prototype.forEach.call(main.children, function (section) {
      if (section.querySelector('input[type="search"]')) return;
      if (section.querySelector('a[href^="/p/"], a[href*="/reel/"]')) hide(section);
    });
  }

  // With the grid gone /explore/ would be an empty page, so go straight to
  // Instagram's own search view (/explore/search/) with the recent searches:
  // focusing the search box is what opens it. "Peruuta" would only lead back
  // to the empty page, so it is hidden.
  function openRecentSearches() {
    if (location.pathname.indexOf('/explore/') !== 0) return;
    var input = document.querySelector('main nav input[type="search"]');
    if (!input) return;
    if (location.pathname === '/explore/' && document.activeElement !== input) input.focus();
    input.closest('nav').querySelectorAll('[role="button"]').forEach(function (el) {
      if (CANCEL_TEXTS.indexOf(textOf(el)) !== -1) hide(el);
    });
  }

  // The search results list is drawn above the bottom tab bar and is taller
  // than the screen. Bring the tab bar to the front (rules.css) and end each
  // of the list's scroll areas at the top of the tab bar.
  function fitSearchResults() {
    if (location.pathname.indexOf('/explore/search') !== 0) {
      document.querySelectorAll('[' + SEARCH_TAB_BAR_ATTR + ']').forEach(function (el) {
        el.removeAttribute(SEARCH_TAB_BAR_ATTR);
      });
      return;
    }
    var nav = document.querySelector('main nav');
    var tabLink = document.querySelector('a[href="/direct/inbox/"]');
    if (!nav || !tabLink || nav.contains(tabLink)) return;
    var tabBar = tabLink;
    while (tabBar.parentElement && getComputedStyle(tabBar).position !== 'fixed') {
      tabBar = tabBar.parentElement;
    }
    var bottom = window.innerHeight;
    if (getComputedStyle(tabBar).position === 'fixed') {
      tabBar.setAttribute(SEARCH_TAB_BAR_ATTR, '');
      bottom = tabBar.getBoundingClientRect().top;
    }
    var list = nav.querySelector('ul, a[href]');
    for (var el = list && list.parentElement; el && el !== nav; el = el.parentElement) {
      var overflow = getComputedStyle(el).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      var maxHeight = Math.max(0, Math.floor(bottom - el.getBoundingClientRect().top)) + 'px';
      if (el.style.maxHeight !== maxHeight) el.style.setProperty('max-height', maxHeight, 'important');
    }
  }

  // With "Open Instagram" gone, turn the small "Log in" link on the landing
  // page into the big primary button (styled in rules.css). Only the row that
  // also has a "Sign up" button counts, so the real login form is untouched.
  function promoteLoginButton() {
    document.querySelectorAll('button').forEach(function (el) {
      if (el.hasAttribute(PRIMARY_LOGIN_ATTR)) return;
      if (LOGIN_TEXTS.indexOf(textOf(el)) === -1) return;
      var row = el.parentElement;
      if (!row || !hasExactText(row, 'button', SIGNUP_TEXTS)) return;
      row.setAttribute(LOGIN_ROW_ATTR, '');
      el.setAttribute(PRIMARY_LOGIN_ATTR, '');
    });
  }

  // ---------------------------------------------------------------------------
  // Messages-only mode: the inbox's top-left back arrow leads nowhere useful,
  // so it is covered. (Settings live in the app's own native top bar.)
  // ---------------------------------------------------------------------------

  function coverInboxBackArrow() {
    var existing = document.querySelector('[' + BACK_COVER_ATTR + ']');
    if (SETTINGS.messagesOnly && location.pathname.indexOf('/direct/inbox') === 0) {
      if (existing && existing.isConnected) return;
      var cover = document.createElement('div');
      cover.setAttribute(BACK_COVER_ATTR, '');
      cover.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cover);   // taps are swallowed by the click listener
    } else if (existing) {
      existing.remove();
    }
  }

  // ---------------------------------------------------------------------------
  // "Olet ajan tasalla": the Home feed ends once the new posts have been seen
  // ---------------------------------------------------------------------------
  //
  // feed.js decides where the feed ends and cuts Instagram's data there. Here,
  // every post that is at least partly on screen is remembered (first time
  // seen) for feed.js, and the message is placed after the last post.

  var SEEN_POSTS_KEY = 'koukuton-seen-posts';         // localStorage {postId: firstSeenMs}
  var SEEN_POSTS_KEEP_DAYS = 30;
  var DAY_MS = 24 * 60 * 60 * 1000;

  var FEED_END_TEXTS = {
    caughtUp: {
      fi: ['Olet ajan tasalla', 'Olet nähnyt kaikki seuraamiesi tilien uudet julkaisut.'],
      en: ["You're all caught up", "You've seen all new posts from accounts you follow."]
    },
    feedHidden: {
      fi: ['Syöte on piilotettu', 'Tarinat, viestit ja profiilit ovat edelleen käytössä.'],
      en: ['Your feed is hidden', 'Stories, messages and profiles still work.']
    },
    reelEnd: {
      fi: ['Olet ajan tasalla', 'Tämä oli sinulle lähetetty video. Muita videoita ei näytetä.', 'Palaa keskusteluun'],
      en: ["You're all caught up", 'That was the video sent to you. No more videos here.', 'Back to chat']
    }
  };

  function readStored(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  function writeStored(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  var seenPosts = readStored(localStorage, SEEN_POSTS_KEY) || {};
  Object.keys(seenPosts).forEach(function (id) {
    if (Date.now() - seenPosts[id] > SEEN_POSTS_KEEP_DAYS * DAY_MS) delete seenPosts[id];
  });

  function postId(post) {
    var link = post.querySelector('a[href*="/p/"]');
    var match = link && link.getAttribute('href').match(/\/p\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  var seenObserver = new IntersectionObserver(function (entries) {
    var changed = false;
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var id = postId(entry.target);
      if (id && !seenPosts[id]) {
        seenPosts[id] = Date.now();
        changed = true;
      }
    });
    if (changed) writeStored(localStorage, SEEN_POSTS_KEY, seenPosts);
  }, { threshold: 0.4 });

  function buildFeedEndMessage(kind) {
    var lang = (document.documentElement.lang || 'fi').indexOf('en') === 0 ? 'en' : 'fi';
    var texts = FEED_END_TEXTS[kind][lang];
    var box = document.createElement('div');
    box.setAttribute(CAUGHT_UP_ATTR, kind);
    box.innerHTML =
      '<svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">' +
        '<defs><linearGradient id="koukuton-caught-up-gradient" x1="0" y1="1" x2="1" y2="0">' +
          '<stop offset="0" stop-color="#feda75"/>' +
          '<stop offset="0.35" stop-color="#fa7e1e"/>' +
          '<stop offset="0.65" stop-color="#d62976"/>' +
          '<stop offset="1" stop-color="#4f5bd5"/>' +
        '</linearGradient></defs>' +
        '<circle cx="48" cy="48" r="45" fill="none" stroke="url(#koukuton-caught-up-gradient)" stroke-width="3"/>' +
        '<path d="M31 49 L43 61 L66 36" fill="none" stroke="url(#koukuton-caught-up-gradient)" ' +
          'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    var title = document.createElement('h2');
    title.textContent = texts[0];
    var body = document.createElement('p');
    body.textContent = texts[1];
    box.appendChild(title);
    box.appendChild(body);
    if (texts[2]) {
      var back = document.createElement('div');
      back.setAttribute(REEL_BACK_ATTR, '');
      back.setAttribute('role', 'button');
      back.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
        '<path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
      back.appendChild(document.createTextNode(texts[2]));
      box.appendChild(back);
    }
    return box;
  }

  function endFeedWhenCaughtUp() {
    if (!isHomeFeed()) return;
    var posts = document.querySelectorAll('article');
    posts.forEach(function (post) {
      if (post.hasAttribute(OBSERVED_ATTR)) return;
      post.setAttribute(OBSERVED_ATTR, '');
      seenObserver.observe(post);
    });

    var kind = window.koukutonFeedEnd;
    if (!kind) return;
    var message = document.querySelector('[' + CAUGHT_UP_ATTR + '="' + kind + '"]') || buildFeedEndMessage(kind);
    // No posts at all: nothing new since last time.
    var previous = posts.length ? posts[0].parentElement : document.querySelector('[data-pagelet="story_tray"]');
    if (previous) {
      if (previous.nextElementSibling !== message) previous.after(message);
    } else {
      var main = document.querySelector('main');
      if (main && message.parentElement !== main) main.appendChild(message);
    }
  }

  // Instagram's list asks for the next page only when the page scrolls. A
  // page of nothing but unwanted posts leaves nothing to scroll, so its spinner
  // would turn until the next swipe: while the end of the list is in view and
  // the feed hasn't ended, it is told about a scroll now and then.
  var NUDGE_INTERVAL_MS = 500;
  var NUDGE_MAX_ATTEMPTS = 60;  // without a new visible post, e.g. no network
  var lastNudge = 0;
  var nudgeAttempts = 0;
  var nudgedVisiblePosts = -1;

  function loadMoreWhenAtEnd() {
    if (!isHomeFeed() || window.koukutonFeedEnd) return;
    var now = Date.now();
    if (now - lastNudge < NUDGE_INTERVAL_MS) return;
    if (!document.getElementsByTagName('article').length) return;
    var root = document.documentElement;
    if (root.scrollHeight - window.innerHeight - window.scrollY > window.innerHeight) return;
    var visiblePosts = document.querySelectorAll('article:not([' + UNWANTED_ATTR + '])').length;
    if (visiblePosts !== nudgedVisiblePosts) {
      nudgedVisiblePosts = visiblePosts;
      nudgeAttempts = 0;
    }
    if (nudgeAttempts >= NUDGE_MAX_ATTEMPTS) return;
    nudgeAttempts++;
    lastNudge = now;
    window.dispatchEvent(new Event('scroll'));
    setTimeout(scheduleRules, NUDGE_INTERVAL_MS);
  }

  // A reel opened from a DM plays in a vertical, snapping list that goes on
  // to more reels. Keep only the first one; after it comes "Olet ajan
  // tasalla" with a button back to the conversation.
  var reelScrollers = new WeakMap();   // video -> its snapping list (or null)

  function reelScrollerOf(video) {
    if (reelScrollers.has(video)) return reelScrollers.get(video);
    var scroller = null;
    for (var el = video.parentElement; el && el !== document.body; el = el.parentElement) {
      var style = getComputedStyle(el);
      if (style.scrollSnapType.indexOf('y') === 0 &&
          (style.overflowY === 'scroll' || style.overflowY === 'auto')) {
        scroller = el;
        break;
      }
    }
    reelScrollers.set(video, scroller);
    return scroller;
  }

  function endReelsAfterFirst() {
    document.querySelectorAll('video').forEach(function (video) {
      if (video.closest('[' + HIDDEN_ATTR + ']')) return;
      var scroller = reelScrollerOf(video);
      if (!scroller || !scroller.firstElementChild) return;
      var message = scroller.querySelector(':scope > [' + CAUGHT_UP_ATTR + ']');
      if (!message) {
        message = buildFeedEndMessage('reelEnd');
        scroller.firstElementChild.after(message);
        // The viewer is still animating open now; size again once it scrolls.
        scroller.addEventListener('scroll', function () { fitReelEnd(message); }, { passive: true });
      }
      fitReelEnd(message);
      fillReelWidth(video, scroller);
      Array.prototype.forEach.call(scroller.children, function (child, i) {
        if (i > 0 && child !== message) child.setAttribute(HIDDEN_ATTR, '');
      });
    });
  }

  // Instagram sizes the reel by its height (9:16). With the top bar and the
  // reply field there is too little height for the full screen width: a black
  // bar is left on the right, and it clips the like and comment buttons.
  function fillReelWidth(video, scroller) {
    var fullWidth = scroller.clientWidth;
    for (var el = video.parentElement; el && el !== scroller; el = el.parentElement) {
      if (el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < fullWidth - 1) {
        el.setAttribute(REEL_FILL_ATTR, '');
      }
    }
  }

  // The message fills one full "page" of the snapping list.
  function fitReelEnd(message) {
    var height = message.parentElement.clientHeight + 'px';
    if (message.style.height !== height) message.style.height = height;
  }

  // "Palaa keskusteluun" presses the reel viewer's own close arrow.
  function closeReelViewer(from) {
    var selector = CLOSE_LABELS.map(function (label) {
      return 'svg[aria-label="' + label + '"]';
    }).join(', ');
    for (var el = from.parentElement; el && el !== document.body; el = el.parentElement) {
      var icon = el.querySelector(selector);
      if (icon) {
        (icon.closest('[role="button"]') || icon).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
    }
    history.back();
  }

  // ---------------------------------------------------------------------------
  // Swiping back: the system's swipe from the very edge of the screen is easy to
  // miss, so SiteWebView.swift also recognizes a swipe to the right anywhere on
  // the page and calls this. (A page can't see it itself: iOS cancels its touch
  // events as soon as the web view starts handling a drag.)
  // ---------------------------------------------------------------------------

  function canSwipeBackHere() {
    if (isHomeFeed() || location.pathname.indexOf('/stories/') === 0) return false;
    if (SETTINGS.messagesOnly && location.pathname.indexOf('/direct/inbox') === 0) return false;
    return !document.querySelector('[' + CAUGHT_UP_ATTR + '="reelEnd"]');   // reel viewer open
  }

  // Swipes that already mean something: text fields, a post's image carousel,
  // anything that scrolls sideways (e.g. the stories tray).
  function usesSideSwipe(target) {
    if (target.closest('input, textarea, [contenteditable="true"]')) return true;
    var list = target.closest('article ul');
    if (list && list.childElementCount > 1) return true;
    for (var el = target; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1) {
        var overflow = getComputedStyle(el).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
    }
    return false;
  }

  // x, y: where the swipe started, in page coordinates of the screen.
  window.koukutonSwipeBack = function (x, y) {
    var target = document.elementFromPoint(x, y);
    if (target && canSwipeBackHere() && !usesSideSwipe(target)) history.back();
  };

  // ---------------------------------------------------------------------------

  function applyRules() {
    hideBlockedLinks();
    hideOpenAppButtons();
    hideStories();
    hideUnwantedPosts();
    endFeedWhenCaughtUp();
    loadMoreWhenAtEnd();
    endReelsAfterFirst();
    hideComments();
    lockFollowingFeedHeader();
    hideExploreGrid();
    openRecentSearches();
    fitSearchResults();
    coverInboxBackArrow();
    promoteLoginButton();
  }

  // Run at most once per animation frame, however many mutations arrive.
  var scheduled = false;
  function scheduleRules() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      applyRules();
    });
  }

  applyRules();
  new MutationObserver(scheduleRules).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  // The keyboard opening or closing changes how much room the search list
  // has; the tab bar may move a moment after the resize event.
  function rulesAfterResize() {
    scheduleRules();
    setTimeout(scheduleRules, 400);
  }
  window.addEventListener('resize', rulesAfterResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', rulesAfterResize);

  console.log('rules.js loaded');
})();
