# Figma fixture (S8.17b)

Answers for `MAUDE_FIGMA_FIXTURE=<this directory>`: the studio's Figma client reads these files instead of calling
api.figma.com (see `apps/studio/figma/client.ts`). `files_<key>.json` is the page list, `files_<key>_nodes.json` the
page's frames, `images_<key>.json` names each frame's picture as `maude-fixture:<file>`, and the `.svg` files are those
pictures. File key `k8Fq2abcdEFGH12345678` is the link `figma.com/design/k8Fq2abcdEFGH12345678/Uniformy-2027`.
