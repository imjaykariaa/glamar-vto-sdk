/**
 * GlamAR Fashion VTO — Front-end SDK (Apple-inspired, mobile-first)
 *
 * ENGINEER INTEGRATION POINTS — all in the API object at the bottom of the file:
 *
 *   API.fetchCatalog(config) → { items, categories }
 *     GET {apiBaseUrl}/catalog — must return merchant items in the shape
 *     defined below.
 *
 *   API.generateTryOn({ photo, product, size, config }) → { url }
 *     POST {apiBaseUrl}/tryon returns { jobId }; then poll
 *     GET {apiBaseUrl}/tryon/:jobId every ~2s until status === 'complete'.
 *     Implement the polling loop INSIDE this function; resolve with { url }
 *     when the job is done. On timeout/fail, throw — the SDK surfaces a
 *     retry banner.
 *
 *   API.addToCart(product, size, config) → { ok, bagUrl? }
 *     Either hit {apiBaseUrl}/cart yourself, or delegate to the
 *     merchant-supplied config.onAddToCart(product, size) hook (recommended).
 *
 * CONFIG — passed to GlamarVTO.init({...}):
 *   container: HTMLElement | string selector     (default '#glamar-vto-root')
 *   apiKey, apiBaseUrl:  GlamAR credentials
 *   catalog, categories: pre-loaded overrides for API.fetchCatalog
 *   defaultPhotoUrl:     string | null — optional pre-filled "before" photo
 *                        (pass null to force the empty "Try it on" state)
 *   onEvent:             fn({ type, data, timestamp }) — analytics hook
 *   onAddToCart:         fn(product, size) → Promise<{ ok, bagUrl? }>
 *   onClose:             fn() — merchant handler for the top-right X.
 *                        If omitted, the SDK fades its root container out.
 *
 * EVENTS emitted via onEvent (22 total):
 *   ready, upload_start, upload_complete, photo_confirm, photo_retake,
 *   file_too_large, catalog_open, catalog_close, product_select, size_select,
 *   tryon_start, tryon_complete, tryon_error, tryon_cancel, compare_toggle,
 *   add_to_cart, add_to_cart_error, share_start, share_menu_open, share,
 *   share_error, help_open, close
 *
 * CATALOG ITEM SHAPE:
 *   {
 *     id: string,
 *     name: string,
 *     categoryId: string,
 *     image: string,              // product thumbnail URL (4:5 recommended)
 *     price: number,              // minor units in the given currency
 *     priceCompareAt?: number,    // optional strikethrough price
 *     currency: string,           // ISO 4217 (e.g. 'INR', 'USD')
 *     sizes: [{ label, sku, inStock: boolean }],
 *     stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock',
 *     tryOnAsset: string          // URL passed to the try-on engine
 *   }
 *
 * CATEGORY SHAPE: { id: string, label: string }
 *
 * Session model: photo is held in-memory only (URL.createObjectURL). Not
 * persisted across sessions — every fresh SDK load starts from the empty state.
 */
(function (global) {
  'use strict';

  // ---------- Demo catalog ----------
  // Three real Indonesian fashion collections: Minimal, MOC, Manzone.
  // Engineer: replace DEFAULT_* below with live merchant data from
  // API.fetchCatalog, or feed it via GlamarVTO.init({ catalog, categories }).
  const DEFAULT_CATEGORIES = [
    { id: 'all',     label: 'All' },
    { id: 'minimal', label: 'Minimal' },
    { id: 'moc',     label: 'MOC' },
    { id: 'manzone', label: 'Manzone' },
  ];

  // Size presets per garment type (no live sizing data from the source sites)
  const SIZES_WOMENS_CLOTHING = [
    { label: 'XS', sku: '-xs', inStock: true },
    { label: 'S',  sku: '-s',  inStock: true },
    { label: 'M',  sku: '-m',  inStock: true },
    { label: 'L',  sku: '-l',  inStock: true },
    { label: 'XL', sku: '-xl', inStock: false },
  ];
  const SIZES_MENS_SHIRT = [
    { label: 'S',  sku: '-s',  inStock: true },
    { label: 'M',  sku: '-m',  inStock: true },
    { label: 'L',  sku: '-l',  inStock: true },
    { label: 'XL', sku: '-xl', inStock: true },
  ];
  const SIZES_TROUSERS = [
    { label: '28', sku: '-28', inStock: true },
    { label: '30', sku: '-30', inStock: true },
    { label: '32', sku: '-32', inStock: true },
    { label: '34', sku: '-34', inStock: false },
  ];
  const withSkuPrefix = (prefix, sizes) => sizes.map((s) => ({ ...s, sku: prefix + s.sku }));

  const DEFAULT_ITEMS = [
    // —— Minimal (women's) ————————————————————————————————
    {
      id: 'minimal-clove-dress-cengkeh-orange',
      name: 'Clove Dress Motif Cengkeh — Orange Light',
      categoryId: 'minimal', currency: 'IDR',
      price: 550905, priceCompareAt: 579900,
      image: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175781-minimal_2_feb_20262031.jpg?v=1776230552',
      sizes: withSkuPrefix('mcd-cengkeh', SIZES_WOMENS_CLOTHING),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175781-minimal_2_feb_20262031.jpg?v=1776230552',
    },
    {
      id: 'minimal-selena-blus-floral-blue',
      name: 'Selena Blus Satin Motif Floral — Blue',
      categoryId: 'minimal', currency: 'IDR',
      price: 341905, priceCompareAt: 359900,
      image: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175710-minimal_2_feb_20260434.jpg?v=1773231649',
      sizes: withSkuPrefix('msb-floral', SIZES_WOMENS_CLOTHING),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175710-minimal_2_feb_20260434.jpg?v=1773231649',
    },
    {
      id: 'minimal-raline-blus-wrap-white',
      name: 'Raline Blus Wrap Lengan Panjang — White',
      categoryId: 'minimal', currency: 'IDR',
      price: 341905, priceCompareAt: 359900,
      image: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175760-minimal_2_feb_20261850.jpg?v=1773747234',
      sizes: withSkuPrefix('mrb-wrap', SIZES_WOMENS_CLOTHING),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175760-minimal_2_feb_20261850.jpg?v=1773747234',
    },
    {
      id: 'minimal-solva-dress-vneck-maroon',
      name: 'Solva Dress Katun V-Neck — Maroon',
      categoryId: 'minimal', currency: 'IDR',
      price: 284905, priceCompareAt: 299900,
      image: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175352-minimal_2_feb_20261012.jpg?v=1772691250',
      sizes: withSkuPrefix('msd-vneck', SIZES_WOMENS_CLOTHING),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/175352-minimal_2_feb_20261012.jpg?v=1772691250',
    },
    {
      id: 'minimal-ismaya-dress-batik-kawung-red',
      name: 'Ismaya Dress Motif Batik Kawung — Red',
      categoryId: 'minimal', currency: 'IDR',
      price: 436905, priceCompareAt: 459900,
      image: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/174816-catalog_mn_oct0842.jpg?v=1762927505',
      sizes: withSkuPrefix('mid-batik', SIZES_WOMENS_CLOTHING),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0564/3337/7459/files/174816-catalog_mn_oct0842.jpg?v=1762927505',
    },

    // —— MOC ————————————————————————————————————————————————
    {
      id: 'moc-chobaz',
      name: 'Chobaz',
      categoryId: 'moc', currency: 'IDR',
      price: 129000, priceCompareAt: 399900,
      image: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/products/1_cb68dc3c-39c4-49b8-987c-7b01345e11b0.jpg?v=1757572011',
      sizes: withSkuPrefix('moc-chobaz', SIZES_MENS_SHIRT),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/products/1_cb68dc3c-39c4-49b8-987c-7b01345e11b0.jpg?v=1757572011',
    },
    {
      id: 'moc-kemeja-brokio-olive',
      name: 'Kemeja Lengan Pendek Brokio — Olive',
      categoryId: 'moc', currency: 'IDR',
      price: 199000, priceCompareAt: 449900,
      image: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/products/sg-11134201-23010-zlgb3rlmvomv00.jpg?v=1757570605',
      sizes: withSkuPrefix('moc-brokio', SIZES_MENS_SHIRT),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/products/sg-11134201-23010-zlgb3rlmvomv00.jpg?v=1757570605',
    },
    {
      id: 'moc-krocce',
      name: 'Krocce',
      categoryId: 'moc', currency: 'IDR',
      price: 179000, priceCompareAt: 439900,
      image: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/products/2638103-4274-3018362-1.jpg?v=1757571957',
      sizes: withSkuPrefix('moc-krocce', SIZES_MENS_SHIRT),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/products/2638103-4274-3018362-1.jpg?v=1757571957',
    },
    {
      id: 'moc-kemeja-koko-jafer-black',
      name: 'Kemeja Koko Lengan Panjang Jafer — Black',
      categoryId: 'moc', currency: 'IDR',
      price: 267000, priceCompareAt: 469900,
      image: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/files/171755-1.jpg?v=1772701177',
      sizes: withSkuPrefix('moc-jafer', SIZES_MENS_SHIRT),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/files/171755-1.jpg?v=1772701177',
    },
    {
      id: 'moc-chinos-jaco-light-grey',
      name: 'Celana Panjang Chinos Jaco — Light Grey',
      categoryId: 'moc', currency: 'IDR',
      price: 329900, priceCompareAt: null,
      image: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/files/175132-1.jpg?v=1774504806',
      sizes: withSkuPrefix('moc-jaco', SIZES_TROUSERS),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0595/3719/5184/files/175132-1.jpg?v=1774504806',
    },

    // —— Manzone (men's) —————————————————————————————————————
    {
      id: 'manzone-koko-saeed-white',
      name: 'Kemeja Koko Lengan Pendek Saeed Comfort Fit — White',
      categoryId: 'manzone', currency: 'IDR',
      price: 199900, priceCompareAt: 459900,
      image: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/171280-depan_460fb895-7ddf-48d1-9760-67b59b733c9c.jpg?v=1757481491',
      sizes: withSkuPrefix('mz-saeed', SIZES_MENS_SHIRT),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/171280-depan_460fb895-7ddf-48d1-9760-67b59b733c9c.jpg?v=1757481491',
    },
    {
      id: 'manzone-batik-damar-04-black',
      name: 'Kemeja Batik Lengan Pendek Damar 04 Comfort Fit — Black',
      categoryId: 'manzone', currency: 'IDR',
      price: 259900, priceCompareAt: null,
      image: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/175763-1_depan.jpg?v=1775644983',
      sizes: withSkuPrefix('mz-damar', SIZES_MENS_SHIRT),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/175763-1_depan.jpg?v=1775644983',
    },
    {
      id: 'manzone-amiri-celana-ornament-beige',
      name: 'Amiri Celana Lurus Motif Ornament — Beige',
      categoryId: 'manzone', currency: 'IDR',
      price: 311952, priceCompareAt: 649900,
      image: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/CatalogMM19december10603.jpg?v=1769578919',
      sizes: withSkuPrefix('mz-amiri', SIZES_TROUSERS),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/CatalogMM19december10603.jpg?v=1769578919',
    },
    {
      id: 'manzone-denim-kmell-1-black',
      name: 'Celana Panjang Denim Kmell 1 Slim Fit — Black',
      categoryId: 'manzone', currency: 'IDR',
      price: 275940, priceCompareAt: null,
      image: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/171210-1_depan_762x1100_cacbd98b-7315-4644-9a4e-0f1a85b05b4a.jpg?v=1760527526',
      sizes: withSkuPrefix('mz-kmell', SIZES_TROUSERS),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/171210-1_depan_762x1100_cacbd98b-7315-4644-9a4e-0f1a85b05b4a.jpg?v=1760527526',
    },
    {
      id: 'manzone-chinos-menno-3-navy',
      name: 'Celana Panjang Chinos Regular Fit Menno 3 — Navy',
      categoryId: 'manzone', currency: 'IDR',
      price: 149900, priceCompareAt: 299900,
      image: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/170961-depan.jpg?v=1760344397',
      sizes: withSkuPrefix('mz-menno', SIZES_TROUSERS),
      stockStatus: 'in_stock',
      tryOnAsset: 'https://cdn.shopify.com/s/files/1/0563/3848/1313/files/170961-depan.jpg?v=1760344397',
    },
  ];

  const DEFAULT_MODEL_IMAGE =
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1400&h=1867&fit=crop';

  // ---------- Icons (design-system primitive) ----------
  // All icons: viewBox 24×24, stroke 1.75, round caps/joins, currentColor.
  // Exceptions: the confirmation check and slider chevrons use 2.0 stroke
  // for emphasis — they are accents, not chrome.
  const svgAttrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  const icons = {
    help:      `<svg ${svgAttrs}><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>`,
    compare:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="7" height="14" rx="1.5" fill="currentColor" stroke="none"/><rect x="13" y="5" width="7" height="14" rx="1.5"/></svg>`,
    compareOff:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="7" height="14" rx="1.5"/><rect x="13" y="5" width="7" height="14" rx="1.5"/></svg>`,
    download:  `<svg ${svgAttrs}><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 17v2.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>`,
    share:     `<svg ${svgAttrs}><path d="M12 14V4"/><path d="M8 8l4-4 4 4"/><path d="M5 14v5.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>`,
    photo:     `<svg ${svgAttrs}><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M7.5 6l1.2-1.8A1 1 0 0 1 9.5 4h5a1 1 0 0 1 .8.4L16.5 6"/></svg>`,
    addPhoto:  `<svg ${svgAttrs}><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M12 10v6M9 13h6"/></svg>`,
    chevDown:  `<svg ${svgAttrs}><path d="M6 9l6 6 6-6"/></svg>`,
    chevRight: `<svg ${svgAttrs}><path d="M9 6l6 6-6 6"/></svg>`,
    chevLeft:  `<svg ${svgAttrs}><path d="M15 6l-6 6 6 6"/></svg>`,
    close:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 7L7 17"/></svg>`,
    search:    `<svg ${svgAttrs}><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l4 4"/></svg>`,
    error:     `<svg ${svgAttrs}><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none"/></svg>`,
    warning:   `<svg ${svgAttrs}><path d="M12 3.5l10 17.5H2L12 3.5z"/><path d="M12 10v5"/><circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none"/></svg>`,
    offline:   `<svg ${svgAttrs}><path d="M4 4l16 16"/><path d="M5.3 10A10 10 0 0 1 8 8.5"/><path d="M12 6a9 9 0 0 1 7.5 4"/><path d="M8.5 13a5 5 0 0 1 3.5-1.5c.9 0 1.7.2 2.4.6"/><path d="M12 17.5h.01"/></svg>`,
    check:     `<svg ${svgAttrs} stroke-width="2"><path d="M5 12l4.5 4.5L19 7.5"/></svg>`,
    sliderArrows: `<svg ${svgAttrs} stroke-width="2"><path d="M9 8l-3 4 3 4M15 8l3 4-3 4"/></svg>`,
    hanger:    `<svg ${svgAttrs}><path d="M12 7a2 2 0 1 1-2-2"/><path d="M12 8v2l9 5.5a1 1 0 0 1-.5 1.8H3.5a1 1 0 0 1-.5-1.8L12 10"/></svg>`,
    bag:       `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 7V6a4 4 0 0 1 8 0v1h2.2a1 1 0 0 1 1 .9l.9 10.5A2 2 0 0 1 18.1 21H5.9a2 2 0 0 1-2-2.2L4.8 7.9A1 1 0 0 1 5.8 7H8zm2 0h4V6a2 2 0 1 0-4 0v1z"/></svg>`,
    copy:      `<svg ${svgAttrs}><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`,
    twitterX:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2H21l-6.522 7.454L22 22h-6.804l-4.63-6.053L4.9 22H2.143l6.977-7.976L1.5 2h6.96l4.188 5.533L18.244 2zm-1.178 18.34h1.583L7.112 3.56H5.412l11.654 16.78z"/></svg>`,
    whatsapp:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2a9.9 9.9 0 0 0-8.52 14.97L2 22l5.14-1.34A9.9 9.9 0 1 0 12.04 2zm0 18.13a8.22 8.22 0 0 1-4.19-1.15l-.3-.18-3.05.8.81-2.97-.2-.31a8.23 8.23 0 1 1 6.93 3.81zm4.56-6.16c-.25-.12-1.47-.73-1.7-.81-.22-.08-.39-.12-.56.12-.16.25-.63.81-.78.98-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.48-1.38-1.73-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43l-.48-.01c-.17 0-.43.06-.66.31-.22.25-.85.83-.85 2.03 0 1.2.87 2.36.99 2.52.12.17 1.72 2.63 4.17 3.69.58.25 1.04.4 1.4.51.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.19.21-.59.21-1.09.14-1.19-.06-.1-.22-.16-.47-.28z"/></svg>`,
    email:     `<svg ${svgAttrs}><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>`,
  };

  // ---------- SDK ----------
  const GlamarVTO = {
    config: null,
    catalog: { items: [], categories: [] },
    state: {
      userPhoto: null,       // committed "before" photo
      pendingPhoto: null,    // uploaded, awaiting confirm
      selectedProduct: null,
      selectedSize: null,
      resultImage: null,
      isProcessing: false,
      sliderPos: 50,
      compareMode: false,
      sheetMode: null,       // null | 'photo-confirm' | 'product-expanded' | 'error' | 'help'
      catalogOpen: false,
      catalogLoading: false,
      categoryFilter: 'all',
      searchQuery: '',
      error: null,
      addToBagState: 'idle', // idle | loading | success
      bagUrl: null,
      labelsVisible: false,
    },
    els: {},

    init(config) {
      this.config = Object.assign({
        container: '#glamar-vto-root',
        apiKey: null,
        apiBaseUrl: null,
        catalog: null,
        categories: null,
        defaultPhotoUrl: DEFAULT_MODEL_IMAGE, // pass null to force fresh upload
        onEvent: () => {},
        onAddToCart: null, // async (product, size) => { ok, bagUrl }
      }, config || {});

      const root = typeof this.config.container === 'string'
        ? document.querySelector(this.config.container)
        : this.config.container;
      if (!root) throw new Error('[GlamarVTO] container not found');
      this.root = root;

      if (this.config.defaultPhotoUrl) {
        this.state.userPhoto = { url: this.config.defaultPhotoUrl };
      }

      this.mount();
      this.loadCatalog();
      this.emit('ready', {});
    },

    emit(type, data) {
      try { this.config.onEvent({ type, data, timestamp: Date.now() }); } catch (e) {}
    },

    mount() {
      this.root.classList.add('gvto-app');
      this.root.innerHTML = `
        <!-- Canvas (image + slider) — tap to upload when empty -->
        <div class="gvto-canvas" data-role="canvas">
          <img class="gvto-canvas-image" data-role="before" alt="Photo" />
          <div class="gvto-slider is-idle" data-role="slider" style="display:none;">
            <div class="gvto-slider-after-wrap">
              <img class="gvto-slider-after-img" data-role="after" alt="Try-on result" />
            </div>
            <div class="gvto-slider-divider" data-role="divider"></div>
            <div class="gvto-slider-handle" data-role="handle" role="slider" tabindex="0"
              aria-label="Drag to compare before and after" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
              ${icons.sliderArrows}
            </div>
            <div class="gvto-slider-labels">
              <span class="gvto-slider-label">Before</span>
              <span class="gvto-slider-label">After</span>
            </div>
          </div>
          <div class="gvto-empty" data-role="empty" style="display:none;">
            <div class="gvto-empty-card">
              <button class="gvto-empty-help" data-action="help" aria-label="How it works">${icons.help}</button>
              <div class="gvto-empty-headline">See it on you</div>
              <div class="gvto-empty-sub">Upload one photo. Try any piece, in seconds.</div>
              <div class="gvto-empty-examples" aria-hidden="true">
                <div class="gvto-empty-example">
                  <img src="sdk/assets/ref-woman.jpg" alt="" loading="lazy" />
                </div>
                <div class="gvto-empty-example">
                  <img src="sdk/assets/ref-man-beige.jpg" alt="" loading="lazy" />
                </div>
                <div class="gvto-empty-example">
                  <img src="sdk/assets/ref-man-white.jpg" alt="" loading="lazy" />
                </div>
              </div>
              <div class="gvto-empty-tips">
                <div class="gvto-empty-tip">${icons.check}<span>A plain background</span></div>
                <div class="gvto-empty-tip">${icons.check}<span>Face the camera</span></div>
                <div class="gvto-empty-tip">${icons.check}<span>A full front view</span></div>
              </div>
              <button class="gvto-empty-cta" data-action="upload">Add your photo</button>
              <div class="gvto-empty-hint">JPG or PNG · up to 10 MB</div>
            </div>
          </div>
        </div>

        <!-- Left rail — 3 individual floating pills (camera / compare / share) -->
        <div class="gvto-rail" data-role="rail">
          <button class="gvto-rail-btn" data-action="upload" data-role="btn-change-photo" aria-label="Change photo" style="display:none;">${icons.photo}</button>
          <button class="gvto-rail-btn" data-action="compare" data-role="btn-compare" aria-label="Toggle compare" disabled>${icons.compareOff}</button>
          <button class="gvto-rail-btn" data-action="share" data-role="btn-share" aria-label="Share" disabled>${icons.share}</button>
        </div>

        <!-- Close — visual only for now; no-op until a merchant close flow is wired. -->
        <button class="gvto-close-btn" aria-label="Close">${icons.close}</button>

        <!-- Processing — premium long-wait state (30–40s) -->
        <div class="gvto-processing" data-role="processing">
          <div class="gvto-proc-card">
            <div class="gvto-proc-dots" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="gvto-proc-stage" data-role="proc-stage">Analyzing your photo</div>
            <div class="gvto-proc-hint">Usually takes 20–30 seconds</div>
            <button class="gvto-proc-cancel" data-action="cancel-tryon">Cancel</button>
          </div>
        </div>

        <!-- Bottom bar — compact (Pick a style OR product chip OR error) -->
        <div class="gvto-bar" data-role="bar" data-mode="empty">
          <div class="gvto-bar-body" data-role="bar-body"></div>
        </div>

        <!-- Expanded sheet (only for size picker / full product detail) -->
        <div class="gvto-sheet" data-role="sheet">
          <div class="gvto-grabber"></div>
          <button class="gvto-sheet-close" data-action="collapse-sheet" aria-label="Close">${icons.close}</button>
          <div class="gvto-sheet-body" data-role="sheet-body"></div>
        </div>

        <!-- Styles catalog sheet -->
        <div class="gvto-catalog-sheet" data-role="catalog-sheet">
          <div class="gvto-catalog-panel" role="dialog" aria-label="Styles">
            <div class="gvto-catalog-head">
              <div class="gvto-catalog-head-row">
                <div class="gvto-catalog-title">The Collection</div>
                <button class="gvto-catalog-close" data-action="close-catalog" aria-label="Close">${icons.close}</button>
              </div>
              <div class="gvto-search" data-role="search-wrap">
                ${icons.search}
                <input type="text" placeholder="Search the collection" data-role="search-input" />
              </div>
              <div class="gvto-cat-chips" data-role="cat-chips"></div>
            </div>
            <div class="gvto-catalog-body" data-role="catalog-body"></div>
          </div>
        </div>

        <div class="gvto-toast" data-role="toast"></div>

        <!-- Bar coachmark (shown once, after photo confirmed) -->
        <div class="gvto-coach" data-role="coach" style="display:none;">
          <div class="gvto-coach-tip gvto-coach-bar" data-role="coach-bar">
            <span>Browse the collection</span>
            <span class="gvto-coach-arrow gvto-coach-arrow-down"></span>
          </div>
        </div>

        <input type="file" class="gvto-file-input" accept="image/*" data-role="file-input" />
      `;

      const q = (s) => this.root.querySelector(s);
      this.els = {
        canvas: this.root.querySelector('.gvto-canvas'),
        before: q('[data-role="before"]'),
        after: q('[data-role="after"]'),
        slider: q('[data-role="slider"]'),
        sliderDivider: q('[data-role="divider"]'),
        sliderHandle: q('[data-role="handle"]'),
        afterWrap: q('.gvto-slider-after-wrap'),
        empty: q('[data-role="empty"]'),
        processing: q('[data-role="processing"]'),
        bar: q('[data-role="bar"]'),
        barBody: q('[data-role="bar-body"]'),
        sheet: q('[data-role="sheet"]'),
        sheetBody: q('[data-role="sheet-body"]'),
        catalogSheet: q('[data-role="catalog-sheet"]'),
        catalogBody: q('[data-role="catalog-body"]'),
        catChips: q('[data-role="cat-chips"]'),
        searchWrap: q('[data-role="search-wrap"]'),
        searchInput: q('[data-role="search-input"]'),
        btnChangePhoto: q('[data-role="btn-change-photo"]'),
        btnCompare: q('[data-role="btn-compare"]'),
        btnShare: q('[data-role="btn-share"]'),
        toast: q('[data-role="toast"]'),
        fileInput: q('[data-role="file-input"]'),
      };

      this.renderBefore();
      this.updateEmptyState();
      this.updateChromeVisibility();
      this.renderBar();
      this.bindEvents();
      this.attachSliderInteraction();
      this.maybeShowCoachmarks();
    },

    // ---------- Coachmark (one-shot, shown once the bar appears) ----------
    maybeShowCoachmarks() {
      // Only after photo confirmed + no product picked + first session
      let seen = false;
      try { seen = sessionStorage.getItem('gvto-coach-seen') === '1'; } catch (e) {}
      if (seen) return;
      if (!this.state.userPhoto) return;
      if (this.state.selectedProduct) return;
      const coach = this.root.querySelector('[data-role="coach"]');
      if (coach) coach.style.display = 'block';
    },
    dismissCoachmarks() {
      const coach = this.root.querySelector('[data-role="coach"]');
      if (coach) coach.style.display = 'none';
      try { sessionStorage.setItem('gvto-coach-seen', '1'); } catch (e) {}
    },

    bindEvents() {
      // Action delegation
      this.root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-action]');
        if (!t) return;
        const action = t.getAttribute('data-action');
        switch (action) {
          case 'upload': this.els.fileInput.click(); break;
          case 'confirm-photo': this.confirmPhoto(); break;
          case 'retake-photo': this.retakePhoto(); break;
          case 'open-catalog': this.openCatalog(); break;
          case 'close-catalog': this.closeCatalog(); break;
          case 'help': this.openHelpGuide(); break;
          case 'close': this.close(); break;
          case 'share-copy':     this.handleShareTarget('copy'); break;
          case 'share-download': this.handleShareTarget('download'); break;
          case 'share-twitter':  this.handleShareTarget('twitter'); break;
          case 'share-whatsapp': this.handleShareTarget('whatsapp'); break;
          case 'share-email':    this.handleShareTarget('email'); break;
          case 'compare': this.toggleCompare(); break;
          case 'download': this.handleDownload(); break;
          case 'share': this.handleShare(); break;
          case 'expand-sheet': this.expandSheet(); break;
          case 'collapse-sheet': this.collapseSheet(); break;
          case 'choose-another': this.openCatalog(); break;
          case 'add-to-bag': this.handleAddToBag(); break;
          case 'view-bag': if (this.state.bagUrl) window.open(this.state.bagUrl, '_blank'); break;
          case 'retry-tryon': this.runTryOn(); break;
          case 'retry-upload': this.els.fileInput.click(); break;
          case 'clear-search':
            this.state.searchQuery = '';
            this.els.searchInput.value = '';
            this.renderCatalogBody();
            break;
          case 'cancel-tryon': this.cancelTryOn(); break;
          case 'dismiss-error': this.clearError(); break;
        }
      });

      // Category chip clicks
      this.els.catChips.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        this.state.categoryFilter = b.getAttribute('data-cat');
        this.renderCatalogChips();
        this.renderCatalogBody();
      });

      // Size chip clicks (delegation on sheet)
      this.els.sheetBody.addEventListener('click', (e) => {
        const s = e.target.closest('[data-size-sku]');
        if (!s) return;
        const sku = s.getAttribute('data-size-sku');
        const size = this.state.selectedProduct.sizes.find((x) => x.sku === sku);
        if (!size || !size.inStock) return;
        if (this.state.addToBagState === 'loading') return; // ignore size changes mid-add
        this.state.selectedSize = size;
        this.renderSheet();
        this.renderBar();
        this.emit('size_select', { productId: this.state.selectedProduct.id, sku: size.sku });
      });

      // (peek→expand click handler removed — bar handles this now)

      // Catalog product clicks
      this.els.catalogBody.addEventListener('click', (e) => {
        const card = e.target.closest('[data-item-id]');
        if (!card) return;
        const id = card.getAttribute('data-item-id');
        const item = this.catalog.items.find((p) => p.id === id);
        if (item) this.selectProduct(item);
      });

      // Search
      this.els.searchInput.addEventListener('input', (e) => {
        this.state.searchQuery = e.target.value.toLowerCase().trim();
        this.renderCatalogBody();
      });

      // Catalog backdrop close
      this.els.catalogSheet.addEventListener('click', (e) => {
        if (e.target === this.els.catalogSheet) this.closeCatalog();
      });

      // File upload
      this.els.fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) this.handleUpload(file);
        e.target.value = '';
      });
    },

    attachSliderInteraction() {
      let dragging = false;
      const canvasEl = this.els.canvas;

      const move = (clientX) => {
        const rect = canvasEl.getBoundingClientRect();
        const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        this.state.sliderPos = pct;
        this.applySliderPosition();
        this.showLabels();
      };
      const start = (e) => {
        if (!this.state.resultImage || !this.state.compareMode) return;
        dragging = true;
        const pt = e.touches ? e.touches[0] : e;
        move(pt.clientX);
        e.preventDefault();
      };
      const drag = (e) => {
        if (!dragging) return;
        const pt = e.touches ? e.touches[0] : e;
        move(pt.clientX);
      };
      const end = () => {
        dragging = false;
        this.scheduleHideLabels();
      };

      this.els.sliderHandle.addEventListener('mousedown', start);
      this.els.sliderHandle.addEventListener('touchstart', start, { passive: false });
      canvasEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-role="handle"]')) return;
        if (!this.state.resultImage || !this.state.compareMode) return;
        start(e);
      });
      window.addEventListener('mousemove', drag);
      // passive:false — lets us preventDefault inside drag() so native page
      // scroll doesn't fire while the user drags the compare slider on mobile.
      window.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        drag(e);
      }, { passive: false });
      window.addEventListener('mouseup', end);
      window.addEventListener('touchend', end);

      // Keyboard support on handle
      this.els.sliderHandle.addEventListener('keydown', (e) => {
        if (!this.state.resultImage) return;
        let delta = 0;
        if (e.key === 'ArrowLeft') delta = -2;
        else if (e.key === 'ArrowRight') delta = 2;
        else if (e.key === 'Home') { this.state.sliderPos = 0; this.applySliderPosition(); this.showLabels(); this.scheduleHideLabels(); return; }
        else if (e.key === 'End')  { this.state.sliderPos = 100; this.applySliderPosition(); this.showLabels(); this.scheduleHideLabels(); return; }
        if (delta) {
          this.state.sliderPos = Math.max(0, Math.min(100, this.state.sliderPos + delta));
          this.applySliderPosition();
          this.showLabels();
          this.scheduleHideLabels();
          e.preventDefault();
        }
      });
    },

    applySliderPosition() {
      const pct = this.state.sliderPos;
      this.els.afterWrap.style.clipPath = `inset(0 0 0 ${pct}%)`;
      this.els.sliderDivider.style.left = `${pct}%`;
      this.els.sliderHandle.style.left = `${pct}%`;
      this.els.sliderHandle.setAttribute('aria-valuenow', Math.round(pct));
    },

    showLabels() {
      this.els.slider.classList.add('is-active');
      this.els.slider.classList.remove('is-idle');
    },
    scheduleHideLabels() {
      clearTimeout(this._labelTimer);
      this._labelTimer = setTimeout(() => {
        this.els.slider.classList.remove('is-active');
        this.els.slider.classList.add('is-idle');
      }, 3000);
    },

    renderBefore() {
      if (this.state.userPhoto && this.state.userPhoto.url) {
        this.els.before.src = this.state.userPhoto.url;
      } else {
        this.els.before.removeAttribute('src');
      }
    },

    updateEmptyState() {
      const hasAnyPhoto = !!(this.state.userPhoto || this.state.pendingPhoto);
      this.els.empty.style.display = hasAnyPhoto ? 'none' : 'flex';
      this.els.btnChangePhoto.style.display = this.state.userPhoto ? 'flex' : 'none';
    },

    // Progressive disclosure: rail stays visible (greyed) until photo is confirmed,
    // so nothing "appears abruptly". Bar is hidden until confirm.
    updateChromeVisibility() {
      const confirmed = !!this.state.userPhoto;
      const rail = this.root.querySelector('[data-role="rail"]');
      const bar = this.els.bar;
      rail.classList.toggle('is-idle', !confirmed);
      bar.classList.toggle('is-hidden', !confirmed);
    },

    updateToolbarDisabled() {
      const hasResult = !!this.state.resultImage;
      [this.els.btnCompare, this.els.btnShare].forEach((b) => {
        if (b) b.disabled = !hasResult;
      });
    },

    // ---------- Catalog ----------
    async loadCatalog() {
      this.state.catalogLoading = true;
      try {
        const data = await API.fetchCatalog(this.config);
        this.catalog = {
          items: data.items || [],
          categories: data.categories && data.categories.length ? data.categories : DEFAULT_CATEGORIES,
        };
      } catch (err) {
        this.catalog = { items: [], categories: DEFAULT_CATEGORIES };
      } finally {
        this.state.catalogLoading = false;
        this.renderCatalogChips();
        this.renderCatalogBody();
      }
    },

    // Mutual exclusion — only one full-screen overlay at a time
    closeAllOverlays({ keepCatalog = false, keepSheet = false } = {}) {
      if (!keepCatalog && this.state.catalogOpen) this.closeCatalog();
      if (!keepSheet) this.collapseSheet();
      if (this.state.error) this.clearError();
      this.dismissCoachmarks();
    },

    openCatalog() {
      this.closeAllOverlays({ keepCatalog: true });
      this.state.catalogOpen = true;
      this.els.catalogSheet.classList.add('is-open');
      this.els.bar.classList.add('is-dimmed');
      this.root.querySelector('[data-role="rail"]').classList.add('is-dimmed');
      this.emit('catalog_open', {});
    },
    closeCatalog() {
      if (!this.state.catalogOpen) return;
      this.state.catalogOpen = false;
      this.els.catalogSheet.classList.remove('is-open');
      this.els.bar.classList.remove('is-dimmed');
      this.root.querySelector('[data-role="rail"]').classList.remove('is-dimmed');
      this.emit('catalog_close', {});
    },

    renderCatalogChips() {
      const cats = this.catalog.categories;
      if (cats.length <= 1) { this.els.catChips.style.display = 'none'; return; }
      this.els.catChips.innerHTML = cats.map((c) => `
        <button class="gvto-cat-chip ${c.id === this.state.categoryFilter ? 'is-active' : ''}" data-cat="${c.id}">${c.label}</button>
      `).join('');
    },

    renderCatalogBody() {
      const body = this.els.catalogBody;
      if (this.state.catalogLoading) {
        body.innerHTML = `<div class="gvto-catalog-skeleton">${Array(6).fill(0).map(() => `
          <div class="gvto-skel-card"><div class="gvto-skel-thumb"></div><div class="gvto-skel-line"></div><div class="gvto-skel-line s"></div></div>
        `).join('')}</div>`;
        return;
      }

      if (!this.catalog.items.length) {
        body.innerHTML = `
          <div class="gvto-catalog-empty">
            <div class="gvto-catalog-empty-icon">${icons.hanger}</div>
            <div class="gvto-catalog-empty-title">Nothing here yet</div>
            <div class="gvto-catalog-empty-sub">New pieces arriving soon.</div>
          </div>`;
        return;
      }

      const q = this.state.searchQuery;
      const cat = this.state.categoryFilter;
      const filtered = this.catalog.items.filter((p) => {
        const matchCat = cat === 'all' || p.categoryId === cat;
        const matchQ = !q || p.name.toLowerCase().includes(q);
        return matchCat && matchQ;
      });

      if (!filtered.length) {
        body.innerHTML = `
          <div class="gvto-catalog-empty">
            <div class="gvto-catalog-empty-icon">${icons.search}</div>
            <div class="gvto-catalog-empty-title">No matches${q ? ` for "${escapeHtml(q)}"` : ''}</div>
            <div class="gvto-catalog-empty-sub">Adjust your search or category.</div>
            <button class="gvto-btn is-ghost" data-action="clear-search">Clear filters</button>
          </div>`;
        return;
      }

      body.innerHTML = `<div class="gvto-catalog-grid">${filtered.map((p) => `
        <div class="gvto-catalog-item" data-item-id="${p.id}">
          <div class="gvto-catalog-thumb"><img src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy"/></div>
          <div class="gvto-catalog-name">${escapeHtml(p.name)}</div>
          <div class="gvto-catalog-price">${formatPrice(p.price, p.currency)}</div>
        </div>
      `).join('')}</div>`;
    },

    // ---------- Photo upload flow ----------
    async handleUpload(file) {
      if (file.size > 10 * 1024 * 1024) {
        this.emit('file_too_large', { size: file.size });
        this.showError({
          title: "This photo is too large",
          sub: "Please use a file under 10 MB, JPG or PNG.",
          retryLabel: 'Choose another photo',
          onRetry: () => this.els.fileInput.click(),
        });
        return;
      }
      // If a try-on is in-flight, abort it so the new photo doesn't
      // race a stale result back onto the slider.
      if (this.state.isProcessing) this.cancelTryOn();
      this.emit('upload_start', { size: file.size });
      this.closeAllOverlays();
      // Stage the photo for confirmation; preview it on the canvas
      this.state.pendingPhoto = { url: URL.createObjectURL(file), file };
      this.clearResult();
      this.els.before.src = this.state.pendingPhoto.url;
      this.updateEmptyState();
      this.updateChromeVisibility();
      this.showPhotoConfirm();
    },

    showPhotoConfirm() {
      this.closeAllOverlays({ keepSheet: true });
      this.state.sheetMode = 'photo-confirm';
      this.renderSheet();
      this.els.sheet.classList.add('is-open');
      this.els.sheet.classList.remove('is-expanded');
    },

    confirmPhoto() {
      if (!this.state.pendingPhoto) return;
      this.state.userPhoto = this.state.pendingPhoto;
      this.state.pendingPhoto = null;
      this.renderBefore();
      this.updateEmptyState();
      this.updateChromeVisibility();
      this.collapseSheet();
      this.renderBar();
      this.emit('photo_confirm', {});
      this.emit('upload_complete', {});
      if (this.state.selectedProduct) {
        this.runTryOn();
      } else {
        this.maybeShowCoachmarks();
      }
    },

    retakePhoto() {
      this.state.pendingPhoto = null;
      // If there's a prior confirmed photo, restore it; otherwise empty state
      if (this.state.userPhoto) this.els.before.src = this.state.userPhoto.url;
      else this.els.before.removeAttribute('src');
      this.collapseSheet();
      this.updateEmptyState();
      this.updateChromeVisibility();
      this.emit('photo_retake', {});
      this.els.fileInput.click();
    },

    cancelPhotoUpload() {
      this.state.pendingPhoto = null;
      if (this.state.userPhoto) this.els.before.src = this.state.userPhoto.url;
      else this.els.before.removeAttribute('src');
      this.collapseSheet();
      this.updateEmptyState();
      this.updateChromeVisibility();
    },

    clearResult() {
      this.state.resultImage = null;
      this.state.compareMode = false;
      this.els.slider.style.display = 'none';
      this.els.slider.classList.remove('is-compare-off');
      this.els.after.removeAttribute('src');
      this.els.btnCompare.classList.remove('is-active');
      this.updateToolbarDisabled();
    },

    // ---------- Product select + try-on ----------
    async selectProduct(product) {
      this.state.selectedProduct = product;
      this.state.selectedSize = (product.sizes || []).find((s) => s.inStock) || null;
      this.closeCatalog();
      this.dismissCoachmarks();
      this.renderBar();
      this.emit('product_select', { productId: product.id });

      if (!this.state.userPhoto) {
        this.showToast('Add a photo first');
        setTimeout(() => this.els.fileInput.click(), 400);
        return;
      }
      await this.runTryOn();
    },

    async runTryOn() {
      if (!this.state.userPhoto || !this.state.selectedProduct) return;
      this.clearError();
      this.clearResult(); // hide any previous slider so tear can't happen
      this.state.isProcessing = true;
      this._tryOnAborted = false;
      this.startProcessing();
      this.closeAllOverlays();
      this.emit('tryon_start', { productId: this.state.selectedProduct.id });

      try {
        const result = await API.generateTryOn({
          photo: this.state.userPhoto,
          product: this.state.selectedProduct,
          size: this.state.selectedSize,
          config: this.config,
        });
        if (this._tryOnAborted) return;

        // Preload the result image before painting, to prevent overlay tear
        await preloadImage(result.url);
        if (this._tryOnAborted) return;

        this.state.resultImage = result.url;
        this.els.after.src = result.url;
        // Default: compare OFF. Show the "after" full-bleed. Slider chrome hidden.
        this.els.slider.style.display = 'block';
        this.els.slider.classList.add('is-compare-off');
        this.state.sliderPos = 0;
        this.state.compareMode = false;
        this.els.btnCompare.classList.remove('is-active');
        this.els.btnCompare.innerHTML = icons.compareOff;
        this.els.btnCompare.setAttribute('aria-pressed', 'false');
        this.applySliderPosition();
        this.updateToolbarDisabled();
        this.state.addToBagState = 'idle';
        this.renderBar();
        this.stopProcessing();
        this.emit('tryon_complete', { productId: this.state.selectedProduct.id });
      } catch (err) {
        if (this._tryOnAborted) return;
        this.stopProcessing();
        this.clearResult();
        this.showError({
          title: "We could not complete your try-on",
          sub: 'A brief interruption. Please try again in a moment.',
          retryLabel: 'Try again',
          onRetry: () => this.runTryOn(),
          secondaryLabel: 'Choose another style',
          onSecondary: () => this.openCatalog(),
        });
        this.emit('tryon_error', { message: err.message });
      } finally {
        this.state.isProcessing = false;
      }
    },

    cancelTryOn() {
      this._tryOnAborted = true;
      this.state.isProcessing = false;
      this.stopProcessing();
      this.emit('tryon_cancel', {});
    },

    // ---------- Premium processing (30–40s wait) ----------
    // Staged messages + scan-line animation. No fake countdown.
    startProcessing() {
      this.els.processing.classList.add('is-active');
      this.els.bar.classList.add('is-dimmed');
      this.root.querySelector('[data-role="rail"]').classList.add('is-dimmed');
      const stages = [
        'Styling your look',
        'Reading your proportions',
        'Tailoring the fit',
        'Shaping the silhouette',
        'Refining the drape',
        'Matching the light',
        'Softening the shadows',
        'Balancing the tones',
        'Setting the finish',
        'One moment more',
      ];
      const stageEl = this.els.processing.querySelector('[data-role="proc-stage"]');
      let i = 0;
      if (stageEl) stageEl.textContent = stages[0];
      clearInterval(this._procTimer);
      // Progress through stages ONCE — never loop back. Once we reach the
      // final stage, stay there until the try-on resolves. (A looping set
      // makes "One moment more" reappear mid-wait, which reads as broken.)
      this._procTimer = setInterval(() => {
        if (i >= stages.length - 1) return;
        i++;
        if (stageEl) {
          stageEl.style.opacity = '0';
          setTimeout(() => {
            stageEl.textContent = stages[i];
            stageEl.style.opacity = '1';
          }, 220);
        }
      }, 3000);
    },
    stopProcessing() {
      this.els.processing.classList.remove('is-active');
      this.els.bar.classList.remove('is-dimmed');
      this.root.querySelector('[data-role="rail"]').classList.remove('is-dimmed');
      clearInterval(this._procTimer);
    },

    toggleCompare() {
      if (!this.state.resultImage) return;
      this.state.compareMode = !this.state.compareMode;
      this.els.btnCompare.classList.toggle('is-active', this.state.compareMode);
      this.els.btnCompare.innerHTML = this.state.compareMode ? icons.compare : icons.compareOff;
      this.els.btnCompare.setAttribute('aria-pressed', this.state.compareMode ? 'true' : 'false');
      this.els.slider.style.display = 'block';
      this.els.slider.classList.toggle('is-compare-off', !this.state.compareMode);
      this.state.sliderPos = this.state.compareMode ? 50 : 0;
      this.applySliderPosition();
      if (this.state.compareMode) {
        this.showLabels();
        this.scheduleHideLabels();
      }
      this.emit('compare_toggle', { on: this.state.compareMode });
    },

    handleDownload() {
      if (!this.state.resultImage) return;
      const p = this.state.selectedProduct;
      const sz = this.state.selectedSize;
      const slug = p ? p.id + (sz ? '-' + sz.label.toLowerCase() : '') : 'result';
      const a = document.createElement('a');
      a.href = this.state.resultImage;
      a.download = `glamar-tryon-${slug}.jpg`;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.emit('download', { productId: p && p.id });
    },

    async handleShare() {
      if (!this.state.resultImage) return;
      this.emit('share_start', {});
      const p = this.state.selectedProduct;
      const title = p ? p.name : 'My try-on';
      const url = this.state.resultImage;

      // Try native share with the IMAGE FILE (iOS + Android Save-to-Photos,
      // WhatsApp, Messages, Mail, Instagram, …). canShare gates it to mobile
      // platforms — desktop browsers don't support file share.
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) {
          const blob = await response.blob();
          const file = new File([blob], 'glamar-tryon.jpg', { type: blob.type || 'image/jpeg' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title, text: title });
            this.showToast('Shared', { top: true, success: true });
            this.emit('share', { type: 'native-file' });
            return;
          }
        }
      } catch (e) { /* user cancelled or unsupported — fall through */ }

      // Desktop / no file support → open the mini share menu.
      this.openShareMenu({ title, url });
    },

    openShareMenu({ title, url }) {
      this.closeAllOverlays({ keepSheet: true });
      this._shareCtx = { title, url };
      this.state.sheetMode = 'share';
      this.renderSheet();
      this.els.sheet.classList.add('is-open', 'is-expanded');
      this.emit('share_menu_open', {});
    },

    handleShareTarget(target) {
      const ctx = this._shareCtx || {};
      if (target === 'copy') {
        try {
          navigator.clipboard.writeText(ctx.url || '');
          this.collapseSheet();
          this.showToast('Link copied', { top: true, success: true });
          this.emit('share', { type: 'copy' });
        } catch (e) {
          this.showToast('Unable to copy', { top: true, danger: true });
          this.emit('share_error', { type: 'copy' });
        }
        return;
      }
      if (target === 'download') {
        this.handleDownload();
        this.collapseSheet();
        this.emit('share', { type: 'download' });
        return;
      }
      // For link-based targets (twitter/whatsapp/email), the anchor tag's
      // href opens the platform. We close the sheet + emit.
      this.collapseSheet();
      this.emit('share', { type: target });
    },

    // ---------- Add to Bag ----------
    async handleAddToBag() {
      const p = this.state.selectedProduct;
      if (!p || !this.state.selectedSize) return;
      if (this.state.addToBagState === 'loading') return;
      this.state.addToBagState = 'loading';
      this.renderBar(); this.renderSheet();
      try {
        const res = await API.addToCart(p, this.state.selectedSize, this.config);
        if (res && res.ok) {
          this.state.bagUrl = res.bagUrl || null;
          this.state.addToBagState = 'success';
          this.renderBar(); this.renderSheet();
          haptic(20);
          this.showToast('Added to Bag', { top: true, success: true, duration: 2600 });
          this.emit('add_to_cart', { productId: p.id, sku: this.state.selectedSize.sku });
          setTimeout(() => {
            this.state.addToBagState = 'idle';
            this.renderBar(); this.renderSheet();
          }, 3400);
        } else {
          throw new Error('add-to-cart failed');
        }
      } catch (err) {
        this.state.addToBagState = 'idle';
        this.renderBar(); this.renderSheet();
        this.showToast('Unable to add to bag — please try again.', { top: true, danger: true });
        this.emit('add_to_cart_error', { message: err && err.message });
      }
    },

    // ---------- Bottom bar (compact) ----------
    renderBar() {
      const p = this.state.selectedProduct;
      const hasError = this.state.error;
      if (hasError) {
        this.els.bar.setAttribute('data-mode', 'error');
        this.els.barBody.innerHTML = this.tplBarError();
        return;
      }
      if (!p) {
        this.els.bar.setAttribute('data-mode', 'empty');
        this.els.barBody.innerHTML = `
          <button class="gvto-bar-cta" data-action="open-catalog">
            <span>Browse the collection</span>
            <span class="gvto-bar-cta-arrow">${icons.chevRight}</span>
          </button>
        `;
        return;
      }
      // product chip
      const sz = this.state.selectedSize;
      const btnState = this.state.addToBagState;
      const priceBlock = `
        <span class="gvto-price-now">${formatPrice(p.price, p.currency)}</span>
        ${p.priceCompareAt ? `<span class="gvto-price-was">${formatPrice(p.priceCompareAt, p.currency)}</span>` : ''}
      `;
      let addLabel, addAction = 'add-to-bag', addClass = '', addAria = 'Add to Bag';
      if (btnState === 'loading') {
        addLabel = `<span class="gvto-btn-spin" aria-hidden="true"></span>`;
        addAria = 'Adding to Bag';
      } else if (btnState === 'success') {
        addClass = 'is-success';
        if (this.state.bagUrl) {
          addLabel = `${icons.check}<span class="gvto-bar-add-text">View Bag</span>`;
          addAction = 'view-bag';
          addAria = 'View Bag';
        } else {
          addLabel = `${icons.check}<span class="gvto-bar-add-text">Added to Bag</span>`;
          addAria = 'Added to Bag';
        }
      } else {
        addLabel = `${icons.bag}<span class="gvto-bar-add-text">Add to Bag</span>`;
      }

      this.els.bar.setAttribute('data-mode', 'product');
      this.els.barBody.innerHTML = `
        <button class="gvto-bar-float" data-action="open-catalog" aria-label="Try another style">
          ${icons.hanger}<span>Try another style</span>
        </button>
        <div class="gvto-bar-card">
          <button class="gvto-bar-product" data-action="expand-sheet" aria-label="Product details">
            <img class="gvto-bar-thumb" src="${p.image}" alt="" />
            <div class="gvto-bar-info">
              <div class="gvto-bar-name">${escapeHtml(p.name)}</div>
              <div class="gvto-product-price">${priceBlock}</div>
            </div>
          </button>
          <button class="gvto-btn ${addClass} gvto-bar-add" data-action="${addAction}" aria-label="${addAria}" ${!sz || btnState==='loading' ? 'disabled' : ''}>${addLabel}</button>
        </div>
      `;
    },

    tplBarError() {
      const e = this.state.error || {};
      return `
        <div class="gvto-error">
          <div class="gvto-error-icon">${icons.error}</div>
          <div class="gvto-error-body">
            <div class="gvto-error-title">${escapeHtml(e.title || 'Something went wrong')}</div>
            <div class="gvto-error-sub">${escapeHtml(e.sub || '')}</div>
            <div class="gvto-error-actions">
              <button class="gvto-btn" data-action="${e.action || 'retry-tryon'}">${escapeHtml(e.retryLabel || 'Try again')}</button>
              ${e.secondaryLabel ? `<button class="gvto-btn is-ghost" data-action="${e.secondaryAction || 'choose-another'}">${escapeHtml(e.secondaryLabel)}</button>` : ''}
            </div>
          </div>
        </div>
      `;
    },

    // ---------- Expanded sheet (full product detail) ----------
    expandSheet() {
      if (!this.state.selectedProduct) return;
      this.closeAllOverlays({ keepSheet: true });
      this.state.sheetMode = 'product-expanded';
      this.renderSheet();
      this.els.sheet.classList.add('is-open', 'is-expanded');
      // Hide the product card in the bar but keep the "Try another style"
      // float pill visible above the sheet.
      this.els.bar.classList.add('is-sheet-open');
    },
    collapseSheet() {
      this.els.sheet.classList.remove('is-open', 'is-expanded');
      this.state.sheetMode = null;
      this.els.bar.classList.remove('is-sheet-open');
    },
    hideSheet() { this.collapseSheet(); },

    renderSheet() {
      if (this.state.sheetMode === 'product-expanded') {
        this.els.sheetBody.innerHTML = this.tplExpandedProduct();
      } else if (this.state.sheetMode === 'help') {
        this.els.sheetBody.innerHTML = this.tplHelpGuide();
      } else if (this.state.sheetMode === 'photo-confirm') {
        this.els.sheetBody.innerHTML = this.tplPhotoConfirm();
      } else if (this.state.sheetMode === 'share') {
        this.els.sheetBody.innerHTML = this.tplShareMenu();
      } else {
        this.els.sheetBody.innerHTML = '';
      }
    },

    tplShareMenu() {
      const ctx = this._shareCtx || {};
      const text = encodeURIComponent(ctx.title || 'My try-on');
      const link = encodeURIComponent(ctx.url || '');
      const twitter  = `https://twitter.com/intent/tweet?url=${link}&text=${text}`;
      const whatsapp = `https://wa.me/?text=${encodeURIComponent((ctx.title || 'My try-on') + ' ' + (ctx.url || ''))}`;
      const email    = `mailto:?subject=${text}&body=${encodeURIComponent((ctx.title || '') + '\n\n' + (ctx.url || ''))}`;
      return `
        <div class="gvto-share">
          <div class="gvto-share-title">Share your look</div>
          <div class="gvto-share-grid">
            <button class="gvto-share-item" data-action="share-copy" aria-label="Copy link">
              <span class="gvto-share-icon">${icons.copy}</span>
              <span class="gvto-share-label">Copy link</span>
            </button>
            <button class="gvto-share-item" data-action="share-download" aria-label="Download image">
              <span class="gvto-share-icon">${icons.download}</span>
              <span class="gvto-share-label">Download</span>
            </button>
            <a class="gvto-share-item" href="${twitter}" target="_blank" rel="noopener" data-action="share-twitter" aria-label="Share on X">
              <span class="gvto-share-icon">${icons.twitterX}</span>
              <span class="gvto-share-label">X</span>
            </a>
            <a class="gvto-share-item" href="${whatsapp}" target="_blank" rel="noopener" data-action="share-whatsapp" aria-label="Share on WhatsApp">
              <span class="gvto-share-icon">${icons.whatsapp}</span>
              <span class="gvto-share-label">WhatsApp</span>
            </a>
            <a class="gvto-share-item" href="${email}" data-action="share-email" aria-label="Share via Email">
              <span class="gvto-share-icon">${icons.email}</span>
              <span class="gvto-share-label">Email</span>
            </a>
          </div>
        </div>
      `;
    },

    tplPhotoConfirm() {
      return `
        <div class="gvto-confirm">
          <div class="gvto-confirm-title">Use this photo?</div>
          <div class="gvto-confirm-sub">A clear full-body photo yields the finest fit.</div>
          <div class="gvto-confirm-actions">
            <button class="gvto-btn is-secondary" data-action="retake-photo">Retake</button>
            <button class="gvto-btn" data-action="confirm-photo">Use this photo</button>
          </div>
        </div>
      `;
    },

    tplExpandedProduct() {
      const p = this.state.selectedProduct;
      if (!p) return '';
      const sz = this.state.selectedSize;
      const btnState = this.state.addToBagState;
      const priceBlock = `
        <span class="gvto-price-now">${formatPrice(p.price, p.currency)}</span>
        ${p.priceCompareAt ? `<span class="gvto-price-was">${formatPrice(p.priceCompareAt, p.currency)}</span>` : ''}
      `;
      // One-button model: Add to Bag → (loading) → View Bag (green).
      // Matches the bar behaviour — single button swaps in place, no extra row.
      let addLabel, addAction = 'add-to-bag', addClass = '', disabled = !sz;
      if (btnState === 'loading') {
        addLabel = `<div class="gvto-spinner" style="width:18px;height:18px;border-width:2px;border-top-color:#fff;"></div>`;
        disabled = true;
      } else if (btnState === 'success') {
        addClass = 'is-success';
        if (this.state.bagUrl) {
          addLabel = `${icons.check}<span>View Bag</span>`;
          addAction = 'view-bag';
          disabled = false;
        } else {
          addLabel = `${icons.check}<span>Added to Bag</span>`;
          disabled = true;
        }
      } else {
        addLabel = `<span>Add to Bag</span>`;
      }
      const sizes = (p.sizes || []).map((s) => `
        <button class="gvto-size-chip ${sz && s.sku === sz.sku ? 'is-selected' : ''} ${s.inStock ? '' : 'is-oos'}" data-size-sku="${s.sku}">${escapeHtml(s.label)}</button>
      `).join('');
      return `
        <button class="gvto-sheet-try-another" data-action="choose-another" aria-label="Try another style">
          ${icons.hanger}<span>Try another style</span>
        </button>
        <div class="gvto-product">
          <img class="gvto-product-thumb" src="${p.image}" alt="${escapeHtml(p.name)}" style="width:72px;height:92px;"/>
          <div class="gvto-product-info">
            <div class="gvto-product-name">${escapeHtml(p.name)}</div>
            <div class="gvto-product-price">${priceBlock}</div>
          </div>
        </div>
        <div class="gvto-expanded-extras">
          ${p.sizes && p.sizes.length ? `
            <div class="gvto-section-title">Size</div>
            <div class="gvto-sizes">${sizes}</div>
          ` : ''}
          <div class="gvto-cta-stack">
            <button class="gvto-btn ${addClass} gvto-add-full" data-action="${addAction}" ${disabled ? 'disabled' : ''}>${addLabel}</button>
          </div>
        </div>
      `;
    },

    tplHelpGuide() {
      const steps = [
        { icon: icons.addPhoto,    title: 'Add your photo',     sub: 'Upload a clear full-body photo for the best fit.' },
        { icon: icons.hanger,      title: 'Browse the styles',   sub: 'Filter by category or search for a specific piece.' },
        { icon: icons.sliderArrows,title: 'Compare the fit',     sub: 'Drag the handle to reveal before and after.' },
        { icon: icons.photo,       title: 'Change your photo',   sub: 'Tap the camera icon to upload a new photo anytime.' },
        { icon: icons.share,       title: 'Share your look',     sub: 'Save to your device or send to a friend.' },
      ];
      return `
        <div class="gvto-guide">
          <div class="gvto-guide-title">How it works</div>
          <div class="gvto-guide-sub">A quick guide.</div>
          <div class="gvto-guide-steps">
            ${steps.map((s) => `
              <div class="gvto-guide-step">
                <div class="gvto-guide-icon">${s.icon}</div>
                <div class="gvto-guide-text">
                  <div class="gvto-guide-step-title">${s.title}</div>
                  <div class="gvto-guide-step-sub">${s.sub}</div>
                </div>
              </div>
            `).join('')}
          </div>
          <button class="gvto-btn is-full gvto-guide-done" data-action="collapse-sheet">Got it</button>
        </div>
      `;
    },

    openHelpGuide() {
      this.closeAllOverlays({ keepSheet: true });
      this.state.sheetMode = 'help';
      this.renderSheet();
      this.els.sheet.classList.add('is-open', 'is-expanded');
      this.emit('help_open', {});
    },

    showError({ title, sub, retryLabel, onRetry, secondaryLabel, onSecondary }) {
      const actionId = 'retry-' + Date.now().toString(36);
      const secId    = 'sec-'   + Date.now().toString(36);
      this._errorHandlers = {};
      this._errorHandlers[actionId] = onRetry || (() => {});
      if (onSecondary) this._errorHandlers[secId] = onSecondary;
      this.state.error = { title, sub, retryLabel, action: actionId, secondaryLabel, secondaryAction: secId };

      // Tear down any previous handler before mounting a new one. No once:true —
      // a misclick shouldn't consume the listener before the actual action hits.
      if (this._errorHandlerBound) {
        this.els.bar.removeEventListener('click', this._errorHandlerBound);
      }
      const handler = (e) => {
        const t = e.target.closest('[data-action]');
        if (!t) return;
        const a = t.getAttribute('data-action');
        if (this._errorHandlers[a]) {
          e.stopPropagation();
          const fn = this._errorHandlers[a];
          this.clearError();
          fn();
        }
      };
      this._errorHandlerBound = handler;
      this.els.bar.addEventListener('click', handler);
      this.renderBar();
    },

    clearError() {
      if (this._errorHandlerBound) {
        this.els.bar.removeEventListener('click', this._errorHandlerBound);
        this._errorHandlerBound = null;
      }
      this._errorHandlers = {};
      this.state.error = null;
      this.renderBar();
    },

    showToast(msg, opts) {
      opts = opts || {};
      this.els.toast.textContent = msg;
      this.els.toast.classList.toggle('is-top', !!opts.top);
      this.els.toast.classList.toggle('is-success', !!opts.success);
      this.els.toast.classList.toggle('is-danger', !!opts.danger);
      this.els.toast.classList.add('is-visible');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.els.toast.classList.remove('is-visible'), opts.duration || 2400);
    },

    // Public helper
    open(product) { if (product) this.selectProduct(product); },

    // Close / dismiss the SDK. Merchant decides what "close" means via
    // config.onClose — if none provided, the SDK hides itself.
    close() {
      this.closeAllOverlays();
      this.emit('close', {});
      if (typeof this.config.onClose === 'function') {
        this.config.onClose();
      } else {
        // Default behaviour: fade out the container
        this.root.style.opacity = '0';
        this.root.style.pointerEvents = 'none';
        this.root.style.transition = 'opacity 220ms var(--gvto-ease)';
      }
    },
  };

  // ---------- Utilities ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatPrice(minor, currency) {
    if (typeof minor !== 'number') return '';
    const LOCALES = { INR: 'en-IN', USD: 'en-US', EUR: 'en-GB', GBP: 'en-GB', JPY: 'ja-JP' };
    const SYMBOLS = { INR: '₹',     USD: '$',     EUR: '€',     GBP: '£',     JPY: '¥' };
    const locale = LOCALES[currency] || 'en-US';
    const symbol = SYMBOLS[currency] || (currency ? currency + ' ' : '');
    return symbol + minor.toLocaleString(locale);
  }

  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function preloadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // don't block on error
      img.src = url;
    });
  }

  // =========================================================
  // API LAYER — engineer replaces these with real GlamAR calls
  // =========================================================
  const API = {
    /**
     * POST {apiBaseUrl}/photos  (FormData: file)
     * → { photoId, url }
     */
    async uploadUserPhoto(file, config) {
      await sleep(200);
      return { photoId: 'mock_' + Date.now(), url: URL.createObjectURL(file) };
    },

    /**
     * GET {apiBaseUrl}/catalog
     * → { items: Item[], categories: Category[] }
     * Item: { id, name, categoryId, image, price, priceCompareAt, currency,
     *         sizes: [{label, sku, inStock}], stockStatus, tryOnAsset }
     */
    async fetchCatalog(config) {
      await sleep(400);
      if (config && config.catalog) {
        return { items: config.catalog, categories: config.categories || DEFAULT_CATEGORIES };
      }
      return { items: DEFAULT_ITEMS, categories: DEFAULT_CATEGORIES };
    },

    /**
     * POST {apiBaseUrl}/tryon  (body: { photoId, productId, size })
     * → { jobId }; then poll GET {apiBaseUrl}/tryon/:jobId → { status, url }
     *
     * Expected behaviour in production:
     *   Input:  the USER's photo + the selected product + size.
     *   Output: a composite image URL of the USER wearing the GARMENT.
     *
     * Demo behaviour (this stub):
     *   Returns `product.tryOnAsset` (the product's own photo) as a
     *   placeholder so the slider has something to compare against. In
     *   production this must be replaced with the real try-on result URL —
     *   do NOT keep this stub behaviour.
     */
    async generateTryOn({ photo, product, size, config }) {
      await sleep(1800 + Math.random() * 1200);
      return { url: product.tryOnAsset };
    },

    /**
     * Either: POST {apiBaseUrl}/cart (body: { sku, qty })
     * Or: call merchant-supplied onAddToCart hook.
     * → { ok, bagUrl? }
     */
    async addToCart(product, size, config) {
      if (config && typeof config.onAddToCart === 'function') {
        return await config.onAddToCart(product, size);
      }
      await sleep(700);
      return { ok: true, bagUrl: '#bag' };
    },
  };

  global.GlamarVTO = GlamarVTO;
  global.GlamarVTO._API = API;
})(window);
