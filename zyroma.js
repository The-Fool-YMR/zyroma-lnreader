'use strict';

const { load } = require('cheerio');
const { fetchApi } = require('@libs/fetch');
const { NovelStatus } = require('@libs/novelStatus');
const { defaultCover } = require('@libs/defaultCover');

const NOVEL_PATH = /^\/novel\/[^/?#]+\/$/;
const CHAPTER_PATH = /^\/novel\/[^/?#]+\/chapter\/[^/?#]+\/$/;

class ZyromaPlugin {
  constructor() {
    this.id = 'zyroma';
    this.name = 'Zyroma';
    this.site = 'https://zyroma.com';
    this.version = '1.0.0';
    this.icon = 'zyroma.png';
  }

  pathFor(href, pattern) {
    if (!href) return undefined;
    const url = new URL(href, this.site);
    const path = url.pathname.replace(/\/?$/, '/');
    return url.origin === this.site && pattern.test(path) ? path : undefined;
  }

  resolveUrl(path, isNovel) {
    const pattern = isNovel === true ? NOVEL_PATH : CHAPTER_PATH;
    const normalized = this.pathFor(path, pattern)
      || (isNovel === undefined && this.pathFor(path, NOVEL_PATH));
    if (!normalized) throw new Error('Invalid Zyroma novel or chapter link.');
    return this.site + normalized;
  }

  async fetchPage(url) {
    const response = await fetchApi(url);
    const $ = load(await response.text());
    if (response.status === 403 || /^Just a moment/i.test($('title').text())) {
      throw new Error('Zyroma blocked this request. If LNReader offers Open in WebView, try opening Zyroma there and retry.');
    }
    if (!response.ok) throw new Error(`Zyroma returned HTTP ${response.status}.`);
    return $;
  }

  coverFor(image, base = this.site) {
    const src = image.attr('data-src') || image.attr('src');
    if (!src) return defaultCover;
    const url = new URL(src, base);
    return /^https?:$/.test(url.protocol) ? url.href : defaultCover;
  }

  async listNovels(url) {
    const $ = await this.fetchPage(url);
    const novels = new Map();
    $('article.maindet').each((_, article) => {
      const card = $(article);
      card.find('a[href]').each((__, anchor) => {
        const link = $(anchor);
        const path = this.pathFor(link.attr('href'), NOVEL_PATH);
        const name = link.text().trim() || link.attr('title');
        if (path && name && !novels.has(path)) {
          novels.set(path, { path, name, cover: this.coverFor(card.find('img').first()) });
        }
      });
    });
    return Array.from(novels.values());
  }

  popularNovels(pageNo, { showLatestNovels } = {}) {
    const order = showLatestNovels ? 'update' : 'popular';
    return this.listNovels(`${this.site}/novel/?page=${pageNo}&order=${order}`);
  }

  searchNovels(searchTerm, pageNo) {
    const pagePath = pageNo > 1 ? `/page/${pageNo}/` : '/';
    return this.listNovels(`${this.site}${pagePath}?s=${encodeURIComponent(searchTerm)}`);
  }

  async parseNovel(novelPath) {
    const url = this.resolveUrl(novelPath, true);
    const path = new URL(url).pathname;
    const $ = await this.fetchPage(url);
    const name = $('h1.entry-title').first().text().trim();
    if (!name) throw new Error('Zyroma’s novel title could not be found.');

    const chapters = new Map();
    $('a[href]').has('.epl-num').each((_, anchor) => {
      const link = $(anchor);
      const chapterPath = this.pathFor(link.attr('href'), CHAPTER_PATH);
      if (!chapterPath || !chapterPath.startsWith(path + 'chapter/')) return;
      const name = link.find('.epl-num').text().trim();
      if (name) chapters.set(chapterPath, { name, path: chapterPath });
    });

    const statusText = $('.sertostat').first().text().trim();
    const status = Object.values(NovelStatus).find(
      value => value.toLowerCase() === statusText.toLowerCase(),
    ) || NovelStatus.Unknown;
    const author = $('.sertoauth .serl').filter(
      (_, row) => /^author/i.test($(row).find('.sername').text().trim()),
    ).first().find('.serval').text().trim();
    const genres = $('.sertogenre a').map((_, a) => $(a).text().trim()).get();

    return {
      path,
      name,
      cover: this.coverFor($('.sertothumb img').first(), url),
      summary: $('.sersys p').map((_, p) => $(p).text().trim()).get().join('\n\n'),
      author,
      genres: genres.join(', '),
      status,
      chapters: Array.from(chapters.values()).reverse(),
    };
  }

  async parseChapter(chapterPath) {
    const url = this.resolveUrl(chapterPath, false);
    const $ = await this.fetchPage(url);
    const content = $('.epcontent .novel-content').first();
    if (!content.text().trim()) throw new Error('Zyroma’s chapter text could not be found.');
    content.find('script, style, iframe, object, embed, form, link, meta, base').remove();
    content.find('*').each((_, element) => {
      const node = $(element);
      for (const [attribute, value] of Object.entries(element.attribs)) {
        if (/^on/i.test(attribute) || attribute === 'srcdoc' ||
            (/^(href|src)$/i.test(attribute) && /^\s*(?:javascript|data|vbscript):/i.test(value))) {
          node.removeAttr(attribute);
        }
      }
    });
    return content.html();
  }
}

exports.default = new ZyromaPlugin();

