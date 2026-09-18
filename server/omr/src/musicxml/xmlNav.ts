/** Thin navigation helpers over fast-xml-parser's `preserveOrder: true` shape.
 *
 * With preserveOrder, every element is `{ [tagName]: XNode[], ":@"?: attrs }`
 * — document order between *different* sibling tags (e.g. a `<harmony>`
 * before the `<note>` it applies to) is preserved, which plain
 * attribute-object parsing loses. That order is exactly what lets us line
 * chord symbols up against the right beat, so it's worth the extra
 * navigation code below. */

export type XNode = { [tag: string]: XNode[] } & { ":@"?: Record<string, string> };

export function tagOf(node: XNode): string {
  const key = Object.keys(node).find((k) => k !== ":@");
  if (!key) throw new Error("XML node has no tag");
  return key;
}

export function childrenOf(node: XNode): XNode[] {
  const value = node[tagOf(node)];
  return Array.isArray(value) ? value : [];
}

export function attrsOf(node: XNode): Record<string, string> {
  return node[":@"] ?? {};
}

export function textOf(node: XNode): string {
  const textNode = childrenOf(node).find((c) => "#text" in c);
  return textNode ? String((textNode as unknown as Record<string, unknown>)["#text"] ?? "") : "";
}

export function find(node: XNode, tag: string): XNode | undefined {
  return childrenOf(node).find((c) => tagOf(c) === tag);
}

export function findAll(node: XNode, tag: string): XNode[] {
  return childrenOf(node).filter((c) => tagOf(c) === tag);
}

export function findText(node: XNode, tag: string): string | undefined {
  const child = find(node, tag);
  return child ? textOf(child) : undefined;
}
