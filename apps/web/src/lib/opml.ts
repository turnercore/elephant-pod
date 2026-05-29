import type { Podcast } from '@/types/domain';

export function exportOpml(feeds: Podcast[]): string {
  const outlines = feeds
    .map(
      (feed) =>
        `    <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.feedUrl)}" htmlUrl="${escapeXml(feed.websiteUrl || '')}" />`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Elephant Pod Subscriptions</title>
  </head>
  <body>
${outlines}
  </body>
</opml>`;
}

export function importOpml(text: string): string[] {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const outlines = Array.from(doc.querySelectorAll('outline[xmlUrl]'));
  return outlines.map((node) => node.getAttribute('xmlUrl')).filter((url): url is string => Boolean(url));
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
