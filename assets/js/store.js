import { getProductPage, getCategories, getSubcategories } from './services/product-service.js';
import { productCard, setupProductInteractions, escapeHTML as e } from './ui.js';
const $ = s => document.querySelector(s);
const grid = $('#product-grid'), search = $('#product-search'), sort = $('#sort-products');
const status = $('#catalog-status'), count = $('#result-count'), clear = $('#clear-filters');
let subcategories = [];
const categoryNav=document.createElement('nav');categoryNav.className='collection-strip store-category-strip';categoryNav.setAttribute('aria-label','Categories');grid.before(categoryNav);
const subnav = document.createElement('nav'); subnav.className = 'category-chips collection-strip'; subnav.setAttribute('aria-label', 'Subcategories'); grid.before(subnav);
let selectedCategory = 'all';
let selectedSubcategory = new URLSearchParams(location.search).get('subcategory') || 'all';
let categories = [], pages = [], pageIndex = 0, generation = 0, debounce;
const pagination = document.createElement('div'); pagination.className = 'catalog-pagination';
pagination.innerHTML = '<button id="previous-page" class="button button-secondary" type="button">Previous</button><span id="page-number" aria-live="polite"></span><button id="next-page" class="button button-secondary" type="button">Next</button>';
grid.after(pagination);
function filters() { return { category: selectedCategory, search: search.value, sort: sort.value, subcategory: selectedSubcategory }; }
function render() {
  const page = pages[pageIndex];
  grid.innerHTML = page.products.length ? page.products.map(productCard).join('') : '<div class="catalog-empty"><h2>No furniture found.</h2><p>Try another category or a product name, SKU or material.</p></div>';
  count.textContent = `${page.products.length} pieces on this page`;
  $('#previous-page').disabled = pageIndex === 0;
  $('#next-page').disabled = !page.hasMore;
  $('#page-number').textContent = `Page ${pageIndex + 1}`;
  pagination.hidden = pages.length === 1 && !page.hasMore;
}
async function load(reset = true) {
  const seq = ++generation;
  if (reset) { pages = []; pageIndex = 0; }
  grid.setAttribute('aria-busy', 'true'); status.hidden = false; status.textContent = 'Loading the collection…';
  $('#previous-page').disabled = $('#next-page').disabled = true;
  const values = filters(); sort.disabled = false;
  clear.hidden = !values.search.trim() && values.category === 'all' && values.sort === 'featured' && selectedSubcategory === 'all';
  const selected = categories.find(c => c.id === values.category);
  const section = $('.catalog-section'), color = selected?.accent || '#7e6049';
  section.style.setProperty('--category-accent', color); section.style.setProperty('--category-columns', selected?.columns || 3);
  const rgb = [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  section.style.setProperty('--category-ink', rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#28221c':'#fff');
  const availableSubs = subcategories.filter(s => s.category === values.category);
  if (!availableSubs.some(s => s.id === selectedSubcategory)) selectedSubcategory = 'all';
  values.subcategory = selectedSubcategory;
  const focusedCategory = document.activeElement?.dataset.storeCategory;
  const focusedSubcategory = document.activeElement?.dataset.subcategory;
  categoryNav.innerHTML='<button type="button" data-store-category="all" aria-current="'+(values.category==='all')+'">All furniture</button>'+categories.map(c=>`<button type="button" data-store-category="${e(c.id)}" aria-current="${values.category===c.id}">${c.image?`<img src="${e(c.image)}" alt="" width="120" height="90" loading="lazy">`:'<span class="collection-placeholder" aria-hidden="true">◇</span>'}<span>${e(c.name)}</span></button>`).join('');
  subnav.innerHTML = availableSubs.length ? '<button type="button" data-subcategory="all" aria-current="'+(selectedSubcategory === 'all')+'">All pieces</button>' + availableSubs.map(s=>`<button type="button" data-subcategory="${e(s.id)}" aria-current="${s.id===selectedSubcategory}">${s.image?`<img src="${e(s.image)}" alt="" width="120" height="90" loading="lazy">`:'<span class="collection-placeholder" aria-hidden="true">◇</span>'}<span>${e(s.name)}</span></button>`).join('') : '';
  subnav.hidden = !availableSubs.length;
  if (focusedCategory) categoryNav.querySelector(`[data-store-category="${CSS.escape(focusedCategory)}"]`)?.focus({ preventScroll: true });
  if (focusedSubcategory) subnav.querySelector(`[data-subcategory="${CSS.escape(focusedSubcategory)}"]`)?.focus({ preventScroll: true });

  $('h1').innerHTML = selected ? e(selected.name) : 'Find your kind of <em>home.</em>';
  $('.intro-row p').textContent = selected?.description || 'Discover furniture for all the living in between.';
  const url = new URL(location.href);
  for (const key of ['search', 'category', 'sort', 'subcategory']) url.searchParams.delete(key);
  if (values.search.trim()) url.searchParams.set('search', values.search.trim());
  if (values.category !== 'all') url.searchParams.set('category', values.category);
  if (selectedSubcategory !== 'all') url.searchParams.set('subcategory', selectedSubcategory);
  if (values.sort !== 'featured') url.searchParams.set('sort', values.sort);
  history.replaceState(null, '', url);
  try {
    const page = await getProductPage({ ...values, cursor: reset ? null : pages.at(-1)?.cursor });
    if (seq !== generation) return;
    if (!reset && !page.products.length && pages.length) pages.at(-1).hasMore = false;
    else pages.push(page);
    pageIndex = pages.length - 1; render(); status.hidden = true;
  } catch (error) {
    if (seq !== generation) return;
    grid.replaceChildren(); pagination.hidden = true; count.textContent = 'Collection unavailable';
    status.innerHTML = '<p></p><button class="button button-secondary" id="retry-catalog" type="button">Try again</button>';
    status.querySelector('p').textContent = error.message || 'The collection could not be loaded.';
    $('#retry-catalog').addEventListener('click', () => void load(true));
  } finally { if (seq === generation) grid.setAttribute('aria-busy', 'false'); }
}
function reset() { clearTimeout(debounce); search.value = ''; selectedSubcategory = 'all'; selectedCategory = 'all'; sort.value = 'featured'; void load(); }
search.placeholder = 'Search name, SKU or material…'; search.maxLength = 160;
search.addEventListener('input', () => { clearTimeout(debounce); generation++; debounce = setTimeout(() => void load(), 500); });
sort.addEventListener('change', () => { clearTimeout(debounce); void load(); });
categoryNav.addEventListener('click',event=>{const button=event.target.closest('[data-store-category]');if(button){clearTimeout(debounce);selectedCategory=button.dataset.storeCategory;selectedSubcategory='all';void load();}});
subnav.addEventListener('click', event => { const button=event.target.closest('[data-subcategory]'); if(button){selectedSubcategory=button.dataset.subcategory; void load();} });
clear.addEventListener('click', reset);
$('#previous-page').addEventListener('click', () => { if (pageIndex > 0) { pageIndex--; render(); grid.scrollIntoView({ block: 'start' }); } });
$('#next-page').addEventListener('click', () => { if (pageIndex < pages.length - 1) { pageIndex++; render(); } else void load(false); });
search.closest('form')?.addEventListener('submit', event => { event.preventDefault(); clearTimeout(debounce); void load(); });
setupProductInteractions();
let collectionsGeneration=0;
async function refreshCollections(initial=false){
  const version=++collectionsGeneration;
  try{
    const selected=initial?new URLSearchParams(location.search).get('category'):selectedCategory;
    const rows=await Promise.all([getCategories(),getSubcategories()]);if(version!==collectionsGeneration)return;
    [categories,subcategories]=rows;
    selectedCategory=categories.some(c=>c.id===selected)?selected:'all';
    if(initial){const params=new URLSearchParams(location.search);search.value=(params.get('search')||'').slice(0,160);sort.value=['featured','price-asc','price-desc','name'].includes(params.get('sort'))?params.get('sort'):'featured';}
    await load();
  }catch(error){if(version!==collectionsGeneration)return;status.hidden=false;status.textContent=error.message;count.textContent='Collection unavailable';pagination.hidden=true;const retry=document.createElement('button');retry.type='button';retry.className='button button-secondary';retry.textContent='Try again';retry.addEventListener('click',()=>void refreshCollections());status.append(retry);}
}
window.addEventListener('catalog-updated',()=>void refreshCollections());
await refreshCollections(true);
