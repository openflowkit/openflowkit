draw.io files for the importer's tests. Never edit one to make a test pass.

- `flow.drawio`: hand-written for the importer (feat/drawio-import) in draw.io's uncompressed
  format (`host="app.diagrams.net"`), with two pages, a container and labelled connectors. It is
  not a file saved from draw.io.

The rest were saved by draw.io itself: they are its own diagram templates, copied unchanged from
https://github.com/jgraph/drawio (`src/main/webapp/templates/`), © JGraph Ltd, licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Every page in them is compressed.

| File | Template | What it covers |
| --- | --- | --- |
| `flowchart.drawio` | `flowcharts/flowchart_1.xml` | a flowchart: deep fills with white ink, right-angle connectors |
| `swimlanes.drawio` | `flowcharts/cross_functional_flowchart_1.xml` | a pool of six lanes, shapes nested two deep |
| `architecture-images.drawio` | `network/enterprise_1.xml` | 63 pictures from draw.io's image library, see-through fills, a self-loop |
| `aws-compressed.drawio` | `cloud/aws/aws_3.xml` | AWS shapes and groups, navy ink drawn for a white page |
| `dark-drawn.drawio` | `other/infographic_4.xml` | drawn dark: light grey and orange ink on near-black fills |
| `multi-page.drawio` | `flowchart_1.xml` + `cloud/aws/aws_3.xml` | the two templates' `<diagram>` elements, unchanged, in one `<mxfile>`: no template has two pages |

`golden/` holds what each file imports as (`drawio.real.test.ts`), one line per page, shape and
connector. When the importer changes on purpose, regenerate with `npx vitest run
src/services/dsl/drawio.real.test.ts -u` and read the diff against the file in draw.io before
committing it.
