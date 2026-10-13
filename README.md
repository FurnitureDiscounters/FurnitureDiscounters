# Furniture Discounters

GitHub Pages storefront connected to the existing free Spark **Standard Firestore** database. [Download the standalone editor HTML](https://furniturediscounters.github.io/downloads/furniture-editor.html) and save it as `furniture-editor.html` on your computer. A ZIP download remains available in `downloads/`. A standalone local HTML editor manages categories/subcategories, colors/layouts, products/photos, specifications, price history and orders. Local editing and backups work without a login; cloud publishing/restoration uses the authorized store account.

**Publish to Firebase** uploads the full editor catalog, optimized photographs and private order records, then atomically switches the public catalog to the new version. The website reads Firebase instead of the bundled empty JSON catalog. **Load from Firebase** restores the catalog, private orders and customer inquiry numbers on another computer. Incoming website orders and current private cloud order records appear live after verified store sign-in, without loading or replacing the catalog. New customer references are random numbers from 1000–10000 with a fresh pool each Monday in the store’s Pacific timezone; earlier weeks remain searchable. Order-number views show product photos. Homepage category photo cards and the category and subcategory rows below catalog search scroll horizontally with hidden scrollbars, without carousel arrows or a category dropdown. Home, catalog and order pages hide page scrollbars while retaining scrolling. The local editor keeps its single scrolling collection rows. Selecting or removing a photo on an existing category/subcategory saves it locally immediately; new categories/subcategories still need Save to create them. Publish to Firebase reports the custom collection photo count. Open storefront pages listen for published catalog changes and refresh their collection tiles automatically. Checking off an order permanently deletes its public inquiry and private cloud copies, and connected editors remove cached copies automatically. This requires the updated Firestore rules. Customer contact details stay private. No preparing/ready statuses, payments or stock reservations are implemented.

[LOCAL-EDITOR.md](LOCAL-EDITOR.md) explains the editor. [FIREBASE-SETUP.md](FIREBASE-SETUP.md) covers rules and account setup. No real inventory is fabricated. The storefront and editor ZIP have been uploaded to GitHub using the FurnitureDiscounters account. GitHub Pages deploys `main` automatically. Production Firebase rules and store account setup still require the steps in [FIREBASE-SETUP.md](FIREBASE-SETUP.md).

```sh
npm ci
npm run build
npm run build:editor
npm test
npm run serve
```

Requires Node 22, Java 21 for emulator checks, and Python 3. The standalone editor is built outside the public site at `/workspace/local-editor/furniture-editor.html`. Keep `assets/dist` for GitHub Pages and rebuild after JavaScript/config changes. `bash scripts/prepare-cloud.sh` reproduces dependencies/builds using verified Node and frozen npm dependencies. See [VERIFICATION.md](VERIFICATION.md).

`?catalog=local` is an explicit loopback-only fixture mode; production always reads Firebase. `?emulator=1` is restricted to local/file contexts and targets the demo project. Static catalog export is retained for backups and development.
