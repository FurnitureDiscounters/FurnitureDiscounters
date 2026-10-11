"""Real local editor/database/photo export and static storefront checks over local HTTP."""
import json,zipfile,tempfile,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT='http://127.0.0.1:4173/'
EDITOR=os.environ.get('FD_EDITOR_URL','http://127.0.0.1:4175/furniture-editor.html')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(accept_downloads=True);page=context.new_page();errors=[];external=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.on('request',lambda req:external.append(req.url) if not req.url.startswith(('http://127.0.0.1:','data:','blob:')) else None)
 page.add_init_script("Object.defineProperty(window,'showOpenFilePicker',{value:undefined});Object.defineProperty(window,'showSaveFilePicker',{value:undefined});")
 page.goto(EDITOR);expect(page.locator('#save-status')).to_contain_text('Saved on this computer')
 expect(page.locator('#login-form')).to_have_count(0);expect(page.locator('[data-category]')).to_have_count(7)
 page.locator('#new-category').click();page.locator('#category-form [name="name"]').fill('Patio');page.locator('#category-form [name="accent"]').fill('#335577');page.locator('#category-form [name="columns"]').select_option('2');page.locator('#category-photo-upload').set_input_files('assets/images/bed.webp');expect(page.locator('#category-photo-preview img')).to_be_visible();page.locator('#category-form .button-primary').click();expect(page.locator('#selected-category')).to_have_text('Patio')
 page.locator('#new-subcategory').click();page.locator('#subcategory-form [name="name"]').fill('Outdoor Sofas');page.locator('#subcategory-photo-upload').set_input_files('assets/images/dining.webp');expect(page.locator('#subcategory-photo-preview img')).to_be_visible();page.locator('#subcategory-form .button-primary').click();expect(page.locator('#subcategory-list')).to_contain_text('Outdoor Sofas')
 page.locator('#new-product').click();page.locator('#product-form [name="name"]').fill('Outdoor Sofa');page.locator('#product-form [name="sku"]').fill('PATIO1');page.locator('#product-form [name="price"]').fill('999');page.locator('#product-form [name="dimensions"]').fill('80 × 36 × 34 in');page.locator('#product-form [name="material"]').fill('Teak')
 page.locator('#product-photo-upload').set_input_files('assets/images/sofa.webp');expect(page.locator('#product-image-paths')).not_to_have_value('');expect(page.locator('#photo-preview img')).to_have_count(1)
 page.locator('#product-form .button-primary').click();expect(page.locator('#product-editor')).to_be_hidden();expect(page.locator('#editor-products .product-card')).to_have_count(1)
 page.locator('[data-edit-product]').click();page.locator('#product-form [name="price"]').fill('799');expect(page.locator('#product-form [name="oldPrice"]')).to_have_value('999.00');page.locator('#product-form .button-primary').click();expect(page.locator('#editor-products del')).to_have_text('$999');expect(page.locator('#editor-products .current-price')).to_have_text('$799')
 page.reload();expect(page.locator('#editor-products .product-card')).to_have_count(1);expect(page.locator('#editor-products')).to_contain_text('Teak');expect(page.locator('#editor-products del')).to_have_text('$999')
 page.locator('[data-tab="orders"]').click();page.locator('#new-order').click();page.locator('#order-form [name="number"]').fill('LOCAL-123');page.locator('#order-form [name="notes"]').fill('PRIVATE CUSTOMER');page.locator('#order-add-product').select_option(label='Outdoor Sofa');page.locator('#add-order-line').click();page.locator('#order-form .button-primary').click();expect(page.locator('#order-editor')).to_be_hidden()
 page.locator('#order-number-search').fill('local-123');page.locator('#order-search-form button').click();expect(page.locator('#order-results')).to_contain_text('PRIVATE CUSTOMER');expect(page.locator('#order-results')).to_contain_text('Outdoor Sofa')
 with page.expect_download() as info:page.locator('#export-website').click()
 public_path=tempfile.mktemp(suffix='.zip');info.value.save_as(public_path)
 with zipfile.ZipFile(public_path) as z:
  exported=json.loads(z.read('assets/data/catalog.json'));assert 'orders' not in exported;assert 'PRIVATE CUSTOMER' not in json.dumps(exported);assert 'private@tests.invalid' not in json.dumps(exported);photo=exported['products'][0]['images'][0];image=z.read(photo);assert len(image)>0;collection_images={c['imagePath']:z.read(c['imagePath']) for c in exported['categories']+exported['subcategories'] if c.get('imagePath')};assert len(collection_images)==2
 with page.expect_download() as info:page.locator('#backup-database').click()
 backup_path=tempfile.mktemp(suffix='.zip');info.value.save_as(backup_path)
 with zipfile.ZipFile(backup_path) as z:assert json.loads(z.read('database.json'))['orders'][0]['number']=='LOCAL-123';assert z.read(photo)==image
 # Restore actual ZIP into a different browser database (separate context).
 other=browser.new_context();restored=other.new_page();restored.add_init_script("Object.defineProperty(window,'showOpenFilePicker',{value:undefined});")
 restored.goto(EDITOR);expect(restored.locator('#save-status')).to_contain_text('Saved on this computer');restored.on('dialog',lambda dialog:dialog.accept());restored.locator('#database-file').set_input_files(backup_path);expect(restored.locator('#editor-products .product-card')).to_have_count(1);expect(restored.locator('#save-status')).to_contain_text('1 local orders')
 assert restored.locator('#editor-products img').evaluate('(img)=>img.complete && img.naturalWidth>0')
 restored.locator('[data-tab="orders"]').click();restored.locator('[data-delete-order]').click();expect(restored.locator('#order-results')).not_to_contain_text('LOCAL-123');restored.reload();expect(restored.locator('#save-status')).to_contain_text('0 local orders');other.close()
 # Use only exported data/assets to test the actual public bundles, without modifying live source inventory.
 page.route('**/assets/data/catalog.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(exported)))
 page.route('**/'+photo,lambda route:route.fulfill(content_type='image/webp',body=image))
 for path,blob in collection_images.items():page.route('**/'+path,lambda route,request,blob=blob:route.fulfill(content_type='image/webp',body=blob))
 cat=exported['products'][0]['category'];sub=exported['products'][0]['subcategory']
 page.goto(ROOT+'store.html?catalog=local&category='+cat);expect(page.locator('.product-card')).to_have_count(1);expect(page.locator('#subcategory-list')).to_have_count(0);expect(page.locator('[data-subcategory="'+sub+'"]')).to_be_visible();page.locator('[data-subcategory="'+sub+'"]').click()
 assert page.locator('[data-subcategory="'+sub+'"] img').evaluate('(img)=>img.complete&&img.naturalWidth>0')
 assert page.locator('.catalog-section').evaluate("el=>el.style.getPropertyValue('--category-accent')")=='#335577'
 assert page.locator('.catalog-section').evaluate("el=>el.style.getPropertyValue('--category-columns')")=='2'
 expect(page.locator('.product-card del')).to_have_text('$999');expect(page.locator('.product-card .current-price')).to_have_text('$799');page.locator('[data-action="details"]').first.click();expect(page.locator('#product-dialog')).to_contain_text('Teak');expect(page.locator('#product-dialog')).to_contain_text('80 × 36 × 34 in');expect(page.locator('#product-dialog del')).to_have_text('$999')
 page.locator('[data-action="close-details"]').first.click();page.locator('.product-card [data-action="add"]').click();expect(page.locator('[data-cart-count]').first).to_have_text('1');page.goto(ROOT+'order.html?catalog=local');expect(page.locator('#cart-total')).to_have_text('$799');expect(page.locator('#submit-inquiry')).to_be_enabled();expect(page.locator('#public-order-lookup')).to_be_visible()
 page.goto(ROOT+'index.html?catalog=local');expect(page.locator('#home-categories .category-card')).to_have_count(7);expect(page.locator('#home-categories img')).to_have_count(7)
 for width in [1440,768,390,320]:
  page.set_viewport_size({'width':width,'height':900});row=page.locator('#home-categories');expect(page.locator('.collection-scroll-controls')).to_have_count(0);assert row.evaluate('el=>el.scrollWidth<=el.clientWidth');assert row.evaluate('el=>Array.from(el.children).every(card=>card.getBoundingClientRect().left>=el.getBoundingClientRect().left-1 && card.getBoundingClientRect().right<=el.getBoundingClientRect().right+1)');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 for target in [EDITOR,ROOT+'store.html?catalog=local&category='+cat,ROOT+'order.html?catalog=local']:
  page.goto(target)
  for width in [1440,768,390,320]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(target,width)
 assert not errors,errors
 # Editor itself makes no network calls to Firebase when editing/exporting a local database.
 assert not external,external
 browser.close()
print('PASS: automatic database creation, no login, categories/subcategories/colors/layout, photo resizing, local persistence, price history, order number search, private backup/public export separation, ZIP restore, public product details/cart and responsive layouts.')
