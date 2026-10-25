// inspector/selection.js — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

// Phase 12.2/12.3 — the WS `selected` echo is the server's projection
// (SelectedElement) and LACKS the client-only DOM fields the CSS knobs pre-fill
// from (`authored` / `computed` inline style + `customStyles` / `attrs` — all
// captured in the iframe, never round-tripped through the server). When the echo
// is for the SAME element we already hold locally, preserve those fields instead
// of clobbering them to empty (else the server round-trip wipes the custom-CSS /
// custom-attr rows + computed readout right after selection).
// feature-photo-editor — `photoKind`/`photoAsset` (dom-selection.ts) are the SAME
// class of client-only DOM-derived field and belong in this list for the same
// reason: without it, every server-pushed `selected`/`snapshot` restore (a canvas
// switch, a reconnect, the persisted `_active.json` on boot — none of which carry
// these fields) silently drops the Inspector's Photo tab until the next fresh
// click re-derives it live — the "tab is there, then it's gone" flicker.
// P8 C7 (14 ed-ab-tidy): a SET of selected things (several artboards by a marquee) is merged member by member —
// the echo of a set lacks the same client-only fields (world size, geometry, attrs), and the multi-artboard card
// compares them. A member pairs with the previous member of the same identity (id + index, or an id-less
// artboard's selector), in any order.
const sameMember = (a, b) =>
  a?.file === b?.file &&
  (a?.id || b?.id
    ? a?.id === b?.id && (a?.index ?? 0) === (b?.index ?? 0)
    : a?.selector === b?.selector);

export function mergeSelClientFields(incoming, prev) {
  if (Array.isArray(incoming) && Array.isArray(prev)) {
    return incoming.map((inc) => {
      const p = prev.find((x) => sameMember(inc, x));
      return p ? mergeSelClientFields(inc, p) : inc;
    });
  }
  if (!incoming || Array.isArray(incoming) || Array.isArray(prev) || !prev) return incoming;
  // Dogfood follow-up (print artboards) — a whole-ARTBOARD selection has NO
  // data-cd-id (the frame chrome carries only data-dc-screen), so the id
  // identity check below never matched it and every server echo returned
  // `incoming` bare — wiping `attrs` (which carries data-dc-kind/-print for
  // the ArtboardKnobs panel) seconds after each fresh click. The panel then
  // silently fell back to kind='digital' + screen presets even though the
  // artboard was print. Match an id-less pair by the artboard-shaped
  // SELECTOR + file — NOT by artboardId: the server projection
  // (inspect.ts `enrich()`) doesn't round-trip `artboardId` at all, so an
  // artboardId comparison always sees undefined on the echo side and never
  // matches (the second-round bug on this exact spot). The selector IS the
  // identity here — `[data-dc-screen="<id>"]` — and enrich() preserves it.
  if (!incoming.id && !prev.id) {
    const isArtboardSel = (s) =>
      typeof s.selector === 'string' && s.selector.startsWith('[data-dc-screen=');
    if (
      isArtboardSel(incoming) &&
      isArtboardSel(prev) &&
      incoming.selector === prev.selector &&
      incoming.file === prev.file
    ) {
      return {
        ...incoming,
        authored: incoming.authored ?? prev.authored,
        computed: incoming.computed ?? prev.computed,
        customStyles: incoming.customStyles ?? prev.customStyles,
        attrs: incoming.attrs ?? prev.attrs,
        // enrich() drops artboardId/worldW/worldH from the echo entirely —
        // restore them from the local snapshot so ArtboardKnobs keeps its
        // exact W/H and the resize/kind writers keep their target id.
        artboardId: incoming.artboardId ?? prev.artboardId,
        worldW: incoming.worldW ?? prev.worldW,
        worldH: incoming.worldH ?? prev.worldH,
        geometry: incoming.geometry ?? prev.geometry,
      };
    }
    return incoming;
  }
  if (!incoming.id || incoming.id !== prev.id) return incoming;
  return {
    ...incoming,
    authored: incoming.authored ?? prev.authored,
    computed: incoming.computed ?? prev.computed,
    customStyles: incoming.customStyles ?? prev.customStyles,
    attrs: incoming.attrs ?? prev.attrs,
    photoKind: incoming.photoKind ?? prev.photoKind,
    photoAsset: incoming.photoAsset ?? prev.photoAsset,
  };
}
