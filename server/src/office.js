import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';

const MAX_XML_BYTES = 12 * 1024 * 1024;

async function openZip(bytes) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
    if (error) reject(error);
    else resolve(zip);
  }));
}

async function entriesOf(bytes, needed) {
  const zip = await openZip(bytes);
  return new Promise((resolve, reject) => {
    const files = new Map();
    let total = 0;
    function fail(error) {
      zip.close();
      reject(error);
    }
    zip.on('error', fail);
    zip.on('end', () => resolve(files));
    zip.on('entry', entry => {
      if (!needed(entry.fileName)) {
        zip.readEntry();
        return;
      }
      total += entry.uncompressedSize;
      if (total > MAX_XML_BYTES) {
        fail(new Error('Office preview exceeds the XML size limit.'));
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          fail(error);
          return;
        }
        const chunks = [];
        stream.on('error', fail);
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}
function parse(xml, handlers) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('DOCTYPE is forbidden in Office documents.'); });
  for (const [event, handler] of Object.entries(handlers)) parser.on(event, handler);
  parser.write(xml).close();
}
function paragraphs(xml, item) {
  const values = [];
  let value = '';
  let capture = false;
  parse(xml, {
    opentag: tag => {
      if (tag.local === item) value = '';
      if (tag.local === 't') capture = true;
      if (tag.local === 'tab') value += '\t';
      if (tag.local === 'br') value += '\n';
    },
    text: text => { if (capture) value += text; },
    closetag: tag => {
      if (tag.local === 't') capture = false;
      if (tag.local === item) values.push(value);
    },
  });
  return values;
}

const sheetPath = /^xl\/worksheets\/sheet\d+\.xml$/;
function spreadsheetRows(xml, strings) {
  const rows = [];
  let row = [];
  let cell = '';
  let type = '';
  let ref = '';
  let capture = false;
  parse(xml, {
    opentag: ({ local, attributes }) => {
      if (local === 'row') row = [];
      if (local === 'c') {
        cell = '';
        type = attributes.t?.value ?? '';
        ref = attributes.r?.value ?? '';
      }
      if (local === 'v' || (local === 't' && type === 'inlineStr')) capture = true;
    },
    text: text => { if (capture) cell += text; },
    closetag: ({ local }) => {
      if (local === 'v' || local === 't') capture = false;
      if (local === 'c') {
        const value = type === 's' ? strings[Number(cell)] ?? '' : type === 'b' ? (cell === '1' ? 'TRUE' : 'FALSE') : cell;
        if (value) row.push((ref ? ref + '  ' : '') + value);
      }
      if (local === 'row' && row.length) rows.push(row.join('    |    '));
    },
  });
  return rows;
}
function textPage(rows, page) {
  const size = 35;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  if (page > pages) return null;
  const lines = rows.slice((page - 1) * size, page * size);
  return { kind: 'text', page, pages, lines: lines.map(line => line.slice(0, 1200)), truncated: lines.some(line => line.length > 1200) };
}
export async function previewOffice(bytes, mime, page) {
  if (mime.endsWith('wordprocessingml.document')) {
    const file = 'word/document.xml';
    const files = await entriesOf(bytes, name => name === file);
    return textPage(paragraphs(files.get(file), 'p'), page);
  }
  const stringsPath = 'xl/sharedStrings.xml';
  const files = await entriesOf(bytes, name => name === stringsPath || sheetPath.test(name));
  const strings = files.has(stringsPath) ? paragraphs(files.get(stringsPath), 'si') : [];
  const sheets = [...files].filter(([name]) => sheetPath.test(name)).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
  return textPage(sheets.flatMap(([, xml], index) => ['Worksheet ' + (index + 1), ...spreadsheetRows(xml, strings)]), page);
}
