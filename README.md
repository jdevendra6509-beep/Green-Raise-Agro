# Green Raise Agro – Stock Control

**Green Raise Agro Pvt Ltd**  
Office no. 116, First Floor, Amnora Apex, Near Amnora Mall, Hadapsar, Pune 411028, Maharashtra.

An inventory dashboard for the Tally **Payment Register** (stock out) and **Receipt Register** (stock in), where item names are used as ledgers and the voucher amounts are quantities.

Deploy on Vercel (see below). Everyone signs in with a username and password.

## Logins and roles

| Role | Can do |
|---|---|
| **Admin** | Everything: all reports, New Entry (Inward, Outward, Adjust stock), edit and delete entries, documents, masters, company details, settings, and the **Users** page |
| **Warehouse Manager** | Only **New Entry** (Inward and Outward) and the **Entries** list. Cannot adjust stock, edit or delete entries, or see reports, documents, masters or users |

- Logins are kept in the Google Sheet tab **Users** (Username, Name, Role, Password Hash, Status, Created At). Passwords are stored only as a salted scrypt hash, never as plain text. Manage them on **System → Users**: add a person, change their role, reset their password, or set them to Inactive to stop them signing in straight away.
- Anyone can change their own password with **Change password** at the bottom of the menu.
- "Entered by" on every entry is filled in by the server from the signed-in person, so it cannot be typed or faked.
- The server (`api/entries.js`) checks the role on every request, and the sheet script checks that the person is still Active with the same role, so the limits hold even if someone calls the server directly.
- "Keep me signed in" keeps the login for 30 days on that device; otherwise it lasts until the browser tab is closed (at most a day). Sign-ins are signed with `SHEET_SECRET` (or `AUTH_SECRET`, if you set one in Vercel). Changing that secret signs everyone out.
- You can't remove, switch off or demote your own login, so there is always at least one admin.

All data lives in the Google Sheet **Green Raise Agro Stock Entries** ([open](https://docs.google.com/spreadsheets/d/1LLk7_kyH1wcoMpt-LAJUNdH-ArcVmUG1GV1T_oQQW80/edit); tabs Entries, Items, Customers, Vendors, Documents, Company, Users): stock entries, plus the Item, Customer and Vendor masters. Stock is the sum of the entries made on the New Entry page. Opening stock is entered as an Adjustment.

## New Entry page (Google Sheet)

Stock movements are entered on the **New Entry** tab instead of Tally. These include Inward (purchases and returns), **Delivery Challan** (goods dispatched to a customer; this is the stock-out entry) and Adjust stock (add or remove a quantity, or set stock to a counted figure). Back-dated entries are allowed.

- Each entry is saved as rows in the Google Sheet **Green Raise Agro Stock Entries**, sheet `Entries`, one row per item.
- The dashboard reads the sheet live on every visit, so a new entry shows up in every report immediately.
- Deleting an entry marks its rows as `Deleted` in the sheet. Rows are never removed.
- An entry dated inside the Tally period gets a warning, because it would be counted twice if it is also in Tally.
- A "counted stock" adjustment stores the counted figure. The difference is worked out again every time the dashboard recalculates, so the count still holds when back-dated entries are added before it.

How it connects: the page calls `/api/entries` on Vercel (`api/entries.js`). That function talks to the sheet through its Apps Script web app (`google-apps-script/Code.gs`). Vercel keeps two settings: `SHEET_WEBAPP_URL`, the web app address, and `SHEET_SECRET`, the same value as `SECRET` in the script. Browsers never see either of them.

### Delivery Challan

Choosing **Delivery Challan** on New Entry records goods going out and prints the challan.

- **Challan details:** Dispatch from (entity), DC no., date, customer name, address, mobile, email, reference, and for each item the HSN code, packing (e.g. `10 kg`), quantity, unit (e.g. `Box`) and total (worked out from packing × qty, e.g. 5 Box × 10 kg = 50 kg; type over it if needed). Transport: vehicle no., transporter, charges per MT, and the transport total (worked out from the total weight; type over it if needed).
- **Add new from the form:** "+ New" next to Entity, Customer and Supplier, and "+ New item" under the goods, open the master form right on the entry page; the name you typed is filled in, and after saving it is selected in the entry. Warehouse Managers can add new records this way but cannot edit or delete existing ones.
- **Autofill:** picking a customer fills address, mobile and email from the Customer master; picking an item fills HSN, packing and unit from the Item master.
- **DC numbers:** the next number is suggested (highest used + 1). For the very first challan, type the number your pad has reached. A number already used on another challan is refused.
- **Entity:** the entities are kept on Masters → Entities. The entity is only recorded on the challan; it never changes stock.
- **Stock:** only the item quantities change stock, exactly like the old Outward entry. In the Google Sheet the Type stays `Outward`.
- **Printing:** after saving, the challan opens in a preview with **Print 3 copies**: Original – Customer, Duplicate – Transporter and Triplicate – Office, one A4 page each, laid out like the printed challan pad. Any saved challan can be printed again from "Entries made here". Company name, address, phone, email and website come from Settings → Company details.
- **Storage:** the extra details are saved in extra columns of the `Entries` tab (Entity, DC No, Customer Address, Mobile No, Email ID, Reference, Vehicle No, Transporter, Transport Rate (per MT), Transport Charges, HSN Code, Packing, Unit, Line Total). The script adds a column the first time it is needed.

### Masters (Google Sheet)

The same spreadsheet holds three masters, each in its own tab: **Items**, **Customers** and **Vendors**. They are edited on the Masters pages of the dashboard (add, edit, delete, **+ Add column**), or directly in the sheet. Every column you add, in either place, shows up automatically. The first column, `ID`, is used internally, so leave it as it is.

- **Items:** Category (the only source of item categories), MOQ, Max Stock, Lead Time (days), Rate, Unit and Merge Into feed Buy Now and the stock reports, and override the Excel Item Master. Status can be `Active`, `Inactive` (hidden from New Entry) or `Exclude` (not a stock item).
- **Excel upload:** on each master page, **Download template** gives an .xlsx with the master's columns (and a "How to fill" sheet). **Upload Excel** shows how many records will be added, updated or skipped before anything is saved. Records are matched on the name column, ignoring case and spaces; filled cells overwrite, empty cells leave the existing value; extra columns in the file are added to the master; the saved name is never changed.
- **Entities:** the fourth master. These are the places or companies goods are dispatched from, chosen on each delivery challan.
- **Filling from Tally:** "Add … from Tally data" adds every item, customer or vendor name found in the Tally files that isn't in the master yet.
- **New Entry:** item and party suggestions come from the masters and from history.

### Proforma invoices and purchase orders

The **Documents** section has **Proforma Invoice** and **Purchase Order** pages (code in `js/docs.js`).

- **Making a document:** pick the party and its address, GSTIN and state fill in from the Customer or Vendor master. Pick items and their HSN, unit, rate and GST % fill in from the Item master; anything can be changed.
- **Tax:** it is split into CGST + SGST when the party is in the company's state and IGST when not, judged from the state codes at the start of the GSTINs.
- **Totals:** discounts, a round-off to the nearest rupee and the amount in words (Indian system) are calculated.
- **Printing:** **View / Print** prints in the Tally layout on A4. Choose "Save as PDF" in the print dialog to get a PDF.
- **Storage:** documents are saved in the **Documents** tab, one row per item. Editing saves a new version and marks the old rows `Deleted`. Documents do not change stock.
- **Numbering:** voucher numbers run per financial year, for example `PI/26-27/001` and `PO/26-27/001`.
- **Company details:** the Company tab starts filled with the Green Raise Agro name and Hadapsar address (state code 27, Maharashtra); add GSTIN, PAN, phone and bank details. Your name, address, GSTIN, PAN, phone, bank details and declaration print on every document. They are kept in the **Company** tab and edited under Settings → Company details.

### Resetting stock

Stock is reset with one Adjustment entry that has a row for every item: Qty = that item's current stock × −1. Items already at zero get no row. To undo it, delete that entry.

### One-time set-up of the sheet connection

1. Open the Google Sheet, then choose **Extensions → Apps Script**.
2. Replace the code with `google-apps-script/Code.gs`. Change `PASTE_SHEET_SECRET_HERE` to a long secret of your own (20+ random letters and digits), then save.
3. Choose **Deploy → New deployment**, set the type to **Web app**, set *Execute as* to **Me** and *Who has access* to **Anyone**, then click **Deploy**. Allow the permissions it asks for.
4. In Vercel → Project → Settings → Environment Variables, set `SHEET_SECRET` to the same secret, and set `SHEET_WEBAPP_URL` to the **Web app URL**. Then redeploy.

If you change the script later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.



| Tab | Answers |
|---|---|
| Overview | Key counts, alerts, monthly bills vs receipts, the items to buy first, the top sellers, the ABC × FSN matrix |
| Buy Now | Items whose stock won't last until a new order arrives, with the quantity to buy, the last supplier and the last purchase |
| Below MOQ | Stock below the minimum level (from your Item Master, or automatic) |
| Negative | Items with negative stock, the date each went negative, and the last purchase and sale |
| Top Selling | Rank by number of bills, quantity or customers, with the change against the previous period |
| Non-Moving | No sale in 90/180/365 days, plus excess or slow stock |
| Stock Summary | Opening, inward, outward and closing for any period, with MOQ, days of stock, ABC and FSN |
| Entries | Every item line for any date range, filtered by item, party, voucher no. or in/out |
| Customers & Suppliers | Top customers and suppliers, and regular customers who have stopped buying |
| Categories | The same figures grouped by the Category set in the Item Master; items without one show as "Not set" |
| Data Health | Missing opening stock, months with missing inward, condensed exports, duplicate names, and more |
| Settings | Lead time, safety days, cover days, non-moving days, and the Item Master download |

The **Period** selector at the top controls every tab. Stock is always shown as on the **To** date.

## Item Master (optional, recommended)

The registers have no opening stock, so most items show negative stock until you give them one. On the Settings tab, click **Download Item Master**. You get a sheet with one row per item. Fill in what you know and load it together with the two registers:

- **Opening Stock**: stock as on the first date in the registers. Or use **Physical Stock** with its **Count Date**, from a stock count on any date.
- **MOQ**, **Max Stock**, **Lead Time (days)**, **Rate** (enables value-based ABC and stock value).
- **Category**, **Unit**, **Exclude** (Y for non-stock ledgers), **Merge Into** (combines duplicate item names).

## How Buy Now is worked out

- Average daily sale = quantity sold in the last 90 days ÷ 90.
- MOQ = the Item Master value, or else the average monthly sale over the same 3 months last year (for stock as on 27-Oct-26, that is 29-Jul-25 to 27-Oct-25). Items with no sale in those months use the latest 3 months instead.
- Reorder point = the larger of MOQ and average daily sale × (lead time + safety days).
- An item is listed when it was sold at least twice in the window and its stock is at or below the reorder point.
- Buy qty = enough for lead time + 30 days of sale, at least the MOQ and at most the Max Stock. Negative stock counts as zero.

You can change every number on the Settings tab.

## Brand

- Logo: `img/logo.jpg` (sidebar and browser tab).
- Accent colour: leaf green `#3f7a22` (light theme) and `#8cc152` (dark theme), taken from the leaves in the logo.

## Offline use

The page loads its Excel and chart libraries from cdnjs. If there is no internet connection, it uses the copies in `lib/`. Keep that folder and `js/` next to `index.html`.
