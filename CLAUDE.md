# Working on this project

Green Raise Agro Stock Control (Green Raise Agro Pvt Ltd, Hadapsar, Pune) is a single-page inventory dashboard, copied from the STK Stock Control project (`index.html`, with `js/parse.js`), deployed on Vercel. Tally exports live in `data/`. New entries go to a Google Sheet through `api/entries.js` and `google-apps-script/Code.gs`. The README has the details.

## Dashboard design standard (owner's preference — apply to every dashboard)

The owner wants every dashboard to look clean and professional, like this one:

- **Layout**
  - A fixed **left sidebar** with navigation **grouped under small uppercase headings** (for example Dashboard, Transactions, Purchasing, Stock, Sales, System).
  - Each nav item has a simple line icon and its label. Counts sit in a pill on the right, red when something needs attention.
  - The active item has a tinted background and a bar in the project's accent colour on its left edge.
- **Sidebar**
  - Dark neutral background, slightly tinted towards the accent (this project uses green-tinted `#19201a`). Logo tile and brand name at the top. Data sources and file actions in a footer at the bottom.
- **Top bar**
  - Section name as a small uppercase label above the **page title**. Page controls on the right, such as the period/date filter, with any "as on" note underneath.
  - No repeated headings inside the page.
- **Content area**
  - Light grey background. White cards with a 1px border and 8px radius.
  - A summary KPI tile row first, then tables and charts.
  - Status shown with pills that pair colour with an icon and a label (critical, serious, warning, good).
- **Colours**
  - **Each project has its own accent colour.** Only the layout is shared. Choose the accent from the business or its brand. This project uses leaf green `#3f7a22` (dark theme `#8cc152`) from the logo; STK uses copper `#a4552a`. Never reuse another project's accent.
  - One accent colour per project, with neutral greys for everything else.
  - Semantic colours only for status. Every colour is a CSS token, with both light and dark themes designed.
- **Fonts**
  - Barlow Semi Condensed for headings and numbers. IBM Plex Sans for body text. IBM Plex Mono for codes and counts. Tabular numbers in tables.
- **Mobile**
  - On narrow screens the sidebar becomes a slide-out menu opened by a ☰ button. No sideways scrolling. Wide tables scroll inside their own box.
- **Behaviour**
  - Every visit starts on the first page with default filters. Only settings and the saved login are remembered.
- **Writing**
  - Plain, specific labels from the owner's point of view. Indian number format (lakh/crore grouping). Dates as dd-Mmm-yy.
