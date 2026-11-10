/*
 * Koukuton – unread messages reader (JavaScript)
 * Injected at document START into every Instagram page, both in the visible
 * web view and in the hidden one the background message check uses.
 *
 * Instagram's own page asks the server for the Direct badge with a GraphQL
 * query (friendly name "IGDBadgeCountOffMsysQuery"). This script only listens
 * to that request's answer – it never sends anything itself – and passes a
 * small summary to the app ("koukutonMessages" message handler). No message
 * texts or names are read; nothing leaves the phone.
 *
 * Observed answer (2026-11-04): data.get_slide_mailbox_for_iris_subscription
 *   .id                       = the user's own id
 *   .threads_by_folder.edges  = the ~15 most recent threads, each with
 *     as_ig_direct_thread { id, last_activity_timestamp_ms, is_muted,
 *       marked_as_unread, slide_read_receipts [{ participant_fbid,
 *       watermark_timestamp_ms }] }
 * A thread is unread when the user's own read receipt is older than the
 * thread's last activity (or it is marked as unread).
 */
(function () {
  'use strict';

  var BADGE_QUERY = 'IGDBadgeCountOffMsysQuery';

  function report(summary) {
    try {
      window.webkit.messageHandlers.koukutonMessages.postMessage(summary);
    } catch (e) {
      // Handler missing – nothing to do.
    }
  }

  // The answer can hold several JSON documents, one per line.
  function firstJson(text) {
    try {
      return JSON.parse(String(text || '').split('\n')[0]);
    } catch (e) {
      return null;
    }
  }

  function isUnread(thread, viewerId) {
    if (thread.marked_as_unread === true) return true;
    var lastActivity = Number(thread.last_activity_timestamp_ms || 0);
    var own = (thread.slide_read_receipts || []).filter(function (receipt) {
      return String(receipt.participant_fbid) === viewerId;
    })[0];
    // No own receipt at all: the user has never opened the thread.
    return !own || Number(own.watermark_timestamp_ms || 0) < lastActivity;
  }

  function summarize(json) {
    var mailbox = json && json.data && json.data.get_slide_mailbox_for_iris_subscription;
    var edges = mailbox && mailbox.threads_by_folder && mailbox.threads_by_folder.edges;
    if (!mailbox || !mailbox.id || !edges) return null;
    var viewerId = String(mailbox.id);
    return {
      threads: edges.map(function (edge) {
        var thread = (edge.node && edge.node.as_ig_direct_thread) || {};
        return {
          id: String(thread.id || ''),
          lastActivity: Number(thread.last_activity_timestamp_ms || 0),
          muted: thread.is_muted === true,
          unread: isUnread(thread, viewerId)
        };
      })
    };
  }

  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (typeof body === 'string' && body.indexOf(BADGE_QUERY) !== -1) {
      this.addEventListener('load', function () {
        if (this.status !== 200) return;
        var summary = summarize(firstJson(this.responseText));
        if (summary) report(summary);
      });
    }
    return send.apply(this, arguments);
  };
})();
