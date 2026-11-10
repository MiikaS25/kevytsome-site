/*
 * Koukuton – feed filter (JavaScript)
 * Injected at document START into the visible web view.
 *
 * The Home feed is a virtualized list: it mounts posts as they come near the
 * screen and reserves room for the rest with padding. Hiding a mounted post
 * (display:none, or even squeezing it to 1 px) confuses it: the list stops
 * mounting posts or throws the scroll position backwards. So unwanted posts
 * are taken out of Instagram's own feed data before the list ever sees them.
 * rules.js still hides anything that gets through.
 *
 * "Olet ajan tasalla" works the same way: the data is cut at the first post
 * that was already seen in an earlier app session (rules.js remembers seen
 * posts) or that is older than CAUGHT_UP_MAX_AGE_DAYS, and Instagram is told
 * there is nothing more. window.koukutonFeedEnd tells rules.js to show the
 * message. With "Piilota koko syöte" on, the feed is cut at the very start.
 * A feed with no posts at all makes Instagram show suggested accounts instead,
 * so then one post stays in the data and rules.js hides it
 * (window.koukutonFeedEmpty).
 *
 * Observed data (2026-11-05), both in the page's first JSON and in the
 * PolarisFeedRootPaginationCachedQuery answers:
 *   data.xdt_api__v1__feed__timeline__connection.edges[].node = {
 *     media { code, taken_at (seconds), media_type (2 = video),
 *             product_type ("clips"), video_versions, carousel_media [...],
 *             floating_context_items [{ floating_context_item_type: "REPOSTED_BY" }] },
 *     ad, ad4ad_in_webfeed, explore_story, suggested_users, stories_netego,
 *     bloks_netego, abra_icebreakers_in_feed_unit, end_of_feed_demarcator }
 * next to .edges: page_info { has_next_page, end_cursor }.
 *
 * Sponsored stories come the same way, in their own query
 * (PolarisStoriesV3AdsPoolQuery, observed 2026-11-05):
 *   data.xdt_injected_story_units = { ad_media_items [...],
 *     ads_pool_threshold_for_next_request, earliest_request_position }
 *   extensions.all_video_dash_prefetch_representations = their videos, to
 *     be downloaded in advance
 * The story viewer shows them between accounts' stories, so the pool is emptied.
 */
(function () {
  'use strict';

  var FEED_KEY = 'xdt_api__v1__feed__timeline__connection';
  var STORY_ADS_KEY = 'xdt_injected_story_units';
  var INSERTED_UNITS = ['ad', 'ad4ad_in_webfeed', 'explore_story', 'suggested_users',
    'stories_netego', 'bloks_netego', 'abra_icebreakers_in_feed_unit'];
  var SEEN_POSTS_KEY = 'koukuton-seen-posts';         // localStorage {postId: firstSeenMs}
  var SESSION_START_KEY = 'koukuton-session-start';   // sessionStorage, survives reloads
  var CAUGHT_UP_MAX_AGE_DAYS = 3;
  var DAY_MS = 24 * 60 * 60 * 1000;

  var parse = JSON.parse;
  var postsKept = false;

  function readStored(storage, key) {
    try {
      return parse(storage.getItem(key));
    } catch (e) {
      return null;
    }
  }

  // The app session started when this tab first loaded Instagram; reloads
  // (e.g. tapping Home) keep it, a fresh app launch starts a new one.
  var sessionStart = readStored(sessionStorage, SESSION_START_KEY);
  if (!sessionStart) {
    sessionStart = Date.now();
    try {
      sessionStorage.setItem(SESSION_START_KEY, String(sessionStart));
    } catch (e) {}
  }

  function isVideo(media) {
    return media.media_type === 2 || media.product_type === 'clips' || Boolean(media.video_versions);
  }

  function isRepostMark(item) {
    return item.floating_context_item_type === 'REPOSTED_BY';
  }

  function isUnwanted(node) {
    if (!node) return false;
    if (INSERTED_UNITS.some(function (key) { return node[key]; })) return true;
    var media = node.media;
    if (!media) return false;
    var settings = window.koukutonSettings || {};
    if (settings.hideReposts && (media.floating_context_items || []).some(isRepostMark)) return true;
    return Boolean(settings.hideFeedVideos) && (isVideo(media) || (media.carousel_media || []).some(isVideo));
  }

  function isOldNews(node, seenPosts) {
    var media = node && node.media;
    if (!media) return false;
    var seenAt = seenPosts[media.code];
    return Boolean(seenAt && seenAt < sessionStart) ||
      Date.now() - media.taken_at * 1000 > CAUGHT_UP_MAX_AGE_DAYS * DAY_MS;
  }

  function endFeedHere(connection, kind) {
    window.koukutonFeedEnd = kind;
    if (connection.page_info) connection.page_info.has_next_page = false;
  }

  function filterConnection(connection) {
    if (!connection || !Array.isArray(connection.edges)) return;
    var settings = window.koukutonSettings || {};
    var kept = connection.edges.filter(function (edge) { return !isUnwanted(edge.node); });
    if (settings.hideFeed) {
      kept = [];
      endFeedHere(connection, 'feedHidden');
    } else if (settings.caughtUp) {
      var seenPosts = readStored(localStorage, SEEN_POSTS_KEY) || {};
      for (var i = 0; i < kept.length; i++) {
        if (isOldNews(kept[i].node, seenPosts)) {
          kept = kept.slice(0, i);
          endFeedHere(connection, 'caughtUp');
          break;
        }
      }
      if (connection.page_info && connection.page_info.has_next_page === false) endFeedHere(connection, 'caughtUp');
    }
    if (kept.length > 0) {
      postsKept = true;
    } else if (!postsKept && window.koukutonFeedEnd) {
      window.koukutonFeedEmpty = true;
      kept = connection.edges.slice(0, 1);
    } else if (!window.koukutonFeedEnd) {
      // An empty page might stop Instagram from asking for the next one.
      kept = connection.edges.slice(-1);
    }
    connection.edges = kept;
  }

  function emptyStoryAds(units) {
    if (units) units.ad_media_items = [];
  }

  // Calls filter on the value of every wantedKey in the data, however deep.
  function filterIn(value, wantedKey, filter) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { filterIn(item, wantedKey, filter); });
      return;
    }
    Object.keys(value).forEach(function (key) {
      if (key === wantedKey) filter(value[key]);
      else filterIn(value[key], wantedKey, filter);
    });
  }

  function removeStoryAds(answer) {
    filterIn(answer, STORY_ADS_KEY, emptyStoryAds);
    if (answer && answer.extensions) answer.extensions.all_video_dash_prefetch_representations = [];
  }

  // Instagram reads both the page's first data and its later answers with
  // JSON.parse, so this is the one place all this data passes through.
  JSON.parse = function (text) {
    var result = parse.apply(this, arguments);
    if (typeof text === 'string') {
      if (text.indexOf(FEED_KEY) !== -1) filterIn(result, FEED_KEY, filterConnection);
      if (text.indexOf(STORY_ADS_KEY) !== -1) removeStoryAds(result);
    }
    return result;
  };
})();
