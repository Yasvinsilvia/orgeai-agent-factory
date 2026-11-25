import { Type, type FunctionDeclaration } from '@google/genai';
import { parse as parseCsv } from 'csv-parse/sync';
import type { ToolId } from '../../src/types/forge.ts';

export interface ToolRegistryMetadata {
  id: ToolId;
  name: string;
  description: string;
  when_to_attach: string;
}

export const TOOL_REGISTRY_META: Record<ToolId, ToolRegistryMetadata> = {
  csv_lookup: {
    id: 'csv_lookup',
    name: 'CSV Lookup Tool',
    description: 'Filters and queries structured CSV datasets uploaded to the agent workspace by column or keyword.',
    when_to_attach: 'Attach ONLY when CSV files are present and structured table lookup, filtering, or price/part retrieval is needed.',
  },
  calculator: {
    id: 'calculator',
    name: 'Calculator Tool',
    description: 'Evaluates deterministic arithmetic expressions, totals, percentages, discounts, and unit cost calculations.',
    when_to_attach: 'Attach ONLY when the brief involves arithmetic, order totals, bulk discounts, leave/pay math, or numeric computations.',
  },
  public_weather: {
    id: 'public_weather',
    name: 'Public Weather API Tool (Open-Meteo)',
    description: 'Fetches live forecast conditions via the keyless Open-Meteo HTTP API for a specified city or maritime port.',
    when_to_attach: 'Attach ONLY when the brief explicitly requires live weather conditions or forecasts.',
  },
  current_date: {
    id: 'current_date',
    name: 'Current Date Tool',
    description: 'Returns the current calendar date, day of week, and ISO timestamp for date-sensitive policy or deadline checks.',
    when_to_attach: 'Attach ONLY when queries depend on today’s date, current year, or relative deadlines.',
  },
};

export function getFunctionDeclarationsForTools(selectedTools: ToolId[]): FunctionDeclaration[] {
  const declarations: FunctionDeclaration[] = [];

  for (const toolId of selectedTools) {
    if (toolId === 'csv_lookup') {
      declarations.push({
        name: 'csv_lookup',
        description:
          'Search uploaded CSV catalogue/table files for matching rows by keyword, part ID, supplier, or category.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Keyword, part ID, supplier name, or value to search across CSV rows.',
            },
            filename: {
              type: Type.STRING,
              description: 'Optional CSV filename to restrict the search.',
            },
          },
          required: ['query'],
        },
      });
    } else if (toolId === 'calculator') {
      declarations.push({
        name: 'calculator',
        description:
          'Evaluate a deterministic mathematical expression (supports +, -, *, /, parentheses, decimals).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            expression: {
              type: Type.STRING,
              description: 'Arithmetic expression to compute, e.g. "(1450 * 4) * 0.90".',
            },
          },
          required: ['expression'],
        },
      });
    } else if (toolId === 'public_weather') {
      declarations.push({
        name: 'public_weather',
        description: 'Fetch current weather and temperature from Open-Meteo public API for a city.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            location: {
              type: Type.STRING,
              description: 'City or port name, e.g. "Rotterdam" or "Singapore".',
            },
          },
          required: ['location'],
        },
      });
    } else if (toolId === 'current_date') {
      declarations.push({
        name: 'current_date',
        description: 'Get the current UTC date, day of week, and timestamp.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            timezone: {
              type: Type.STRING,
              description: 'Optional label (defaults to UTC).',
            },
          },
        },
      });
    }
  }

  return declarations;
}

// Safe recursive-descent arithmetic evaluator (no eval / Function)
function safeEvaluateMath(expr: string): number {
  const cleaned = expr.replace(/[^0-9+\-*/().\s]/g, '').trim();
  if (!cleaned) throw new Error('Empty or invalid expression');
  let pos = 0;

  function skipWhitespace() {
    while (pos < cleaned.length && /\s/.test(cleaned[pos])) pos++;
  }

  function parseExpression(): number {
    let val = parseTerm();
    skipWhitespace();
    while (pos < cleaned.length && (cleaned[pos] === '+' || cleaned[pos] === '-')) {
      const op = cleaned[pos++];
      const right = parseTerm();
      val = op === '+' ? val + right : val - right;
      skipWhitespace();
    }
    return val;
  }

  function parseTerm(): number {
    let val = parseFactor();
    skipWhitespace();
    while (pos < cleaned.length && (cleaned[pos] === '*' || cleaned[pos] === '/')) {
      const op = cleaned[pos++];
      const right = parseFactor();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        val = val / right;
      } else {
        val = val * right;
      }
      skipWhitespace();
    }
    return val;
  }

  function parseFactor(): number {
    skipWhitespace();
    if (cleaned[pos] === '+') {
      pos++;
      return parseFactor();
    }
    if (cleaned[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    if (cleaned[pos] === '(') {
      pos++;
      const val = parseExpression();
      skipWhitespace();
      if (cleaned[pos] !== ')') throw new Error('Mismatched parenthesis');
      pos++;
      return val;
    }
    const start = pos;
    while (pos < cleaned.length && /[0-9.]/.test(cleaned[pos])) pos++;
    const numStr = cleaned.slice(start, pos);
    const num = Number(numStr);
    if (!numStr || Number.isNaN(num)) throw new Error(`Unexpected token at position ${pos}`);
    return num;
  }

  const result = parseExpression();
  skipWhitespace();
  if (pos < cleaned.length) {
    throw new Error(`Unexpected trailing character "${cleaned[pos]}"`);
  }
  return Number(result.toFixed(6));
}

export interface CsvTableSource {
  filename: string;
  rawCsv: string;
}

export async function executeRegisteredTool(params: {
  toolId: ToolId;
  args: Record<string, unknown>;
  csvSources: CsvTableSource[];
}): Promise<string> {
  if (params.toolId === 'current_date') {
    const now = new Date();
    return JSON.stringify({
      iso_date: now.toISOString().slice(0, 10),
      utc_timestamp: now.toISOString(),
      day_of_week: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    });
  }

  if (params.toolId === 'calculator') {
    const expr = String(params.args.expression ?? '');
    try {
      const value = safeEvaluateMath(expr);
      return JSON.stringify({ expression: expr, result: value });
    } catch (err: unknown) {
      return JSON.stringify({
        expression: expr,
        error: err instanceof Error ? err.message : 'Invalid arithmetic expression',
      });
    }
  }

  if (params.toolId === 'csv_lookup') {
    const query = String(params.args.query ?? '').toLowerCase().trim();
    const targetFile = params.args.filename ? String(params.args.filename).toLowerCase() : null;
    if (params.csvSources.length === 0) {
      return JSON.stringify({ matches: [], note: 'No CSV files uploaded to this workspace.' });
    }
    const terms = query.split(/\s+/).filter(Boolean);
    const matches: Array<{ filename: string; row_number: number; row: Record<string, string> }> = [];

    for (const src of params.csvSources) {
      if (targetFile && !src.filename.toLowerCase().includes(targetFile)) continue;
      const rows = parseCsv(src.rawCsv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Record<string, string>[];
      rows.forEach((row, idx) => {
        const hay = Object.values(row).join(' ').toLowerCase();
        const allMatch = terms.length > 0 && terms.every((t) => hay.includes(t));
        const anyMatch = terms.some((t) => hay.includes(t));
        if (allMatch || (terms.length > 1 && anyMatch && matches.length < 6)) {
          matches.push({
            filename: src.filename,
            row_number: idx + 1,
            row,
          });
        }
      });
    }
    return JSON.stringify({
      query,
      match_count: matches.length,
      matches: matches.slice(0, 10),
    });
  }

  if (params.toolId === 'public_weather') {
    const location = String(params.args.location ?? '').trim();
    if (!location) {
      return JSON.stringify({ error: 'Location parameter is required.' });
    }
    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(6000) });
      const geoJson = (await geoRes.json()) as {
        results?: Array<{ name: string; country: string; latitude: number; longitude: number }>;
      };
      const first = geoJson.results?.[0];
      if (!first) {
        return JSON.stringify({ error: `Location "${location}" not found on Open-Meteo.` });
      }
      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${first.latitude}&longitude=${first.longitude}&current=temperature_2m,wind_speed_10m,weather_code`;
      const wxRes = await fetch(wxUrl, { signal: AbortSignal.timeout(6000) });
      const wxJson = (await wxRes.json()) as {
        current?: { temperature_2m: number; wind_speed_10m: number; weather_code: number; time: string };
      };
      return JSON.stringify({
        location: `${first.name}, ${first.country}`,
        current: wxJson.current ?? null,
      });
    } catch (err: unknown) {
      return JSON.stringify({
        error: `Open-Meteo weather request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${params.toolId}` });
}
