const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TextBlock,
  IndentedList,
  Card,
  ExpandableSection,
  ErrorBanner,
  SuccessBanner,
  LoadingSkeleton
} = require("../ui-components");

test("TextBlock escapes HTML and supports clamp class", () => {
  const html = TextBlock({ text: "<script>alert(1)</script>", tone: "body", maxLines: 2 });
  assert.match(html, /text-block body clamped/);
  assert.doesNotMatch(html, /<script>/);
});

test("IndentedList renders nested list levels", () => {
  const html = IndentedList({
    items: [
      { text: "Parent", children: ["Child 1", "Child 2"] }
    ]
  });
  assert.match(html, /indented-list level-1/);
  assert.match(html, /indented-list level-2/);
});

test("Card, banners, and skeleton render enterprise classes", () => {
  const card = Card({ title: "Overview", bodyHtml: "<p>x</p>" });
  const expandable = ExpandableSection({ id: "audit", title: "Audit", contentHtml: "<pre>{}</pre>", open: true });
  const error = ErrorBanner({ message: "Failed", actions: ["Retry"] });
  const success = SuccessBanner({ message: "Done" });
  const skeleton = LoadingSkeleton({ lines: 2 });
  assert.match(card, /ui-card/);
  assert.match(expandable, /expandable-section/);
  assert.match(error, /action-error/);
  assert.match(success, /action-success/);
  assert.match(skeleton, /loading-skeleton-stack/);
});
