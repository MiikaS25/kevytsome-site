/*
 * Koukuton – shared rule engine for sites other than Instagram (rules.js has
 * grown its own). Injected at document start, before the site's own script.
 *
 * window.koukutonRules.start({...}) blocks paths from links and in-app page
 * changes, hides links to them and the "open in app" buttons, and runs the
 * site's rules on everything that gets added to the page.
 *
 * Use stable signals only (href, aria-label / visible text in Finnish +
 * English, role, data-*) – never a service's random class names. All text
 * lists are lower-case; compare with textOf().
 */
(function () {
  'use strict';

  var HIDDEN_ATTR = 'data-koukuton-hidden';
  var INERT_ATTR = 'data-koukuton-inert';

  var OPEN_APP_TEXTS = ['avaa sovelluksessa', 'avaa sovellus', 'avaa sovellukseen', 'käytä sovellusta',
    'hanki sovellus', 'lataa sovellus', 'open app', 'open in app', 'open the app', 'open in the app',
    'use the app', 'use app', 'get the app', 'get app', 'download app', 'download the app'];

  function textOf(el) {
    return (el.textContent || '').trim().toLowerCase();
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

  // The root itself and everything under it that matches.
  function within(root, selector) {
    var found = Array.prototype.slice.call(root.querySelectorAll(selector));
    if (root.matches(selector)) found.unshift(root);
    return found;
  }

  // Short pieces of text exactly equal to one of the labels.
  function labelsIn(root, labels) {
    return within(root, 'span, p, h2, h3, a, div').filter(function (el) {
      return el.childElementCount === 0 && labels.indexOf(textOf(el)) !== -1;
    });
  }

  var SIDE_SCROLL_MIN_EXCESS = 40;

  // Swipes that already mean something: text fields and anything that scrolls
  // sideways, like a row of photos.
  function usesSideSwipe(target) {
    if (target.closest('input, textarea, [contenteditable="true"], [data-type="hscroller"]')) return true;
    for (var el = target; el && el !== document.body; el = el.parentElement) {
      // A few pixels of excess don't make a page scroll sideways in practice.
      if (el.scrollWidth > el.clientWidth + SIDE_SCROLL_MIN_EXCESS) {
        var overflow = getComputedStyle(el).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
    }
    return false;
  }

  // Guards against a reload loop if the site keeps sending us back.
  function goHome(url) {
    try {
      var last = Number(sessionStorage.getItem('koukuton-redirect') || 0);
      if (Date.now() - last < 5000) return;
      sessionStorage.setItem('koukuton-redirect', String(Date.now()));
    } catch (e) {}
    location.replace(url);
  }

  // site = {
  //   homeUrl:     where a blocked page leads
  //   isBlocked:   function (URL) → true if the page must not open
  //   rules:       function (root) run on every element added to the page
  //   afterRules:  optional, once after each round of rules
  //   canSwipeBack: function () → may a swipe go back on this page?
  // }
  function start(site) {
    function isBlocked(href) {
      try {
        return site.isBlocked(new URL(href, location.href));
      } catch (e) {
        return false;
      }
    }

    if (isBlocked(location.href)) goHome(site.homeUrl);

    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href]');
      if (link && isBlocked(link.getAttribute('href'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        console.log('Koukuton: blocked link ' + link.getAttribute('href').split('?')[0]);
      }
    }, true);

    ['pushState', 'replaceState'].forEach(function (name) {
      var original = history[name];
      history[name] = function (state, title, url) {
        if (url != null && isBlocked(String(url))) {
          console.log('Koukuton: blocked ' + name);
          return;
        }
        return original.apply(this, arguments);
      };
    });

    window.addEventListener('popstate', function () {
      if (isBlocked(location.href)) goHome(site.homeUrl);
    });

    function applyRules(root) {
      within(root, 'a[href]').forEach(function (link) {
        if (isBlocked(link.getAttribute('href'))) hide(link);
      });
      within(root, 'a, button, [role="button"]').forEach(function (el) {
        if (OPEN_APP_TEXTS.indexOf(textOf(el)) !== -1) hide(el);
      });
      site.rules(root);
    }

    // Only what was added is looked at, at most once per animation frame.
    var added = [];
    var scheduled = false;
    function run() {
      scheduled = false;
      var roots = added;
      added = [];
      roots.forEach(function (root) {
        if (root.isConnected) applyRules(root);
      });
      if (site.afterRules) site.afterRules();
    }

    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) added.push(node);
          else if (node.parentElement) added.push(node.parentElement);
        });
      });
      if (added.length && !scheduled) {
        scheduled = true;
        requestAnimationFrame(run);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // x, y: where a swipe to the right started (see SiteWebView.swift).
    window.koukutonSwipeBack = function (x, y) {
      var target = document.elementFromPoint(x, y);
      if (target && site.canSwipeBack() && !usesSideSwipe(target)) history.back();
    };

    console.log('rules loaded: ' + location.hostname);
  }

  // Tells the app how many new notifications the page shows (home screen).
  var lastBadge = null;
  function reportBadge(count) {
    if (count === lastBadge) return;
    lastBadge = count;
    try {
      window.webkit.messageHandlers.koukutonBadge.postMessage(count);
    } catch (e) {}
  }

  window.koukutonRules = {
    reportBadge: reportBadge,
    HIDDEN_ATTR: HIDDEN_ATTR,
    INERT_ATTR: INERT_ATTR,
    textOf: textOf,
    hide: hide,
    within: within,
    labelsIn: labelsIn,
    goHome: goHome,
    start: start
  };
})();
