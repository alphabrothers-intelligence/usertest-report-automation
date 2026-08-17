export function markQuoteEndingReviews(root: HTMLElement, findEndingToken: (quote: string) => string | null) {
  for (const note of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-note]"))) note.remove();
  for (const previousMarker of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-token]"))) {
    previousMarker.replaceWith(...Array.from(previousMarker.childNodes));
  }
  for (const quoteNode of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-text]"))) {
    const quote = decodeURIComponent(quoteNode.dataset.quoteText ?? "");
    const token = findEndingToken(quote);
    quoteNode.removeAttribute("data-quote-ending-review");
    if (!token) continue;
    const paragraph = quoteNode.querySelector("p");
    if (!paragraph) continue;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    const target = [...textNodes].reverse().find((node) => node.data.lastIndexOf(token) >= 0);
    if (!target) continue;
    const start = target.data.lastIndexOf(token);
    const marker = document.createElement("span");
    marker.dataset.quoteEndingToken = "true";
    marker.textContent = token;
    target.replaceWith(document.createTextNode(target.data.slice(0, start)), marker, document.createTextNode(target.data.slice(start + token.length)));
    quoteNode.dataset.quoteEndingReview = "true";
  }
}

export function cleanQuoteEndingReviewMarkup(root: HTMLElement) {
  for (const note of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-note]"))) note.remove();
  for (const marker of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-token]"))) marker.replaceWith(...Array.from(marker.childNodes));
  for (const quoteNode of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-review]"))) quoteNode.removeAttribute("data-quote-ending-review");
}
