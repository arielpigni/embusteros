import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SHEET_URL          = process.env.SHEET_URL;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY;
const WRITE              = process.argv.includes('--write');

if (!SHEET_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Faltan variables de entorno. Copiá migration/.env.example a migration/.env y completá los valores.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function buildCarsMini(movs) {
  const cars = {};
  movs.forEach(m => {
    const k = m.patente;
    if (!cars[k]) cars[k] = { patente: k, marca: m.marca, modelo: m.modelo, compra: 0, gastos: 0, venta: 0 };
    if      (m.tipo === 'Compra') cars[k].compra += m.valor;
    else if (m.tipo === 'Gasto')  cars[k].gastos += m.valor;
    else if (m.tipo === 'Venta')  cars[k].venta  += m.valor;
  });
  Object.values(cars).forEach(c => {
    c.vendido   = c.venta > 0;
    c.inversion = c.compra + c.gastos;
    c.ganancia  = c.vendido ? (c.venta - c.inversion) : null;
  });
  return cars;
}

function summarize(cars) {
  const list     = Object.values(cars);
  const vendidos = list.filter(c => c.vendido);
  const enStock  = list.filter(c => !c.vendido);
  return {
    totalAutos:     list.length,
    vendidos:       vendidos.length,
    enStock:        enStock.length,
    gananciaTotal:  Math.round(vendidos.reduce((s, c) => s + c.ganancia, 0)),
    inversionStock: Math.round(enStock.reduce((s, c) => s + c.inversion, 0)),
  };
}

async function main() {
  console.log(`Modo: ${WRITE ? 'WRITE (inserta en Supabase)' : 'DRY-RUN (solo lee y muestra resumen)'}`);

  const res  = await fetch(SHEET_URL);
  const rows = await res.json();
  const movs = rows
    .filter(r => r['Patente'] && r['Tipo'])
    .map(r => ({
      fecha:   r['Fecha'],
      tipo:    r['Tipo']        || '',
      patente: r['Patente']     || '',
      marca:   r['Marca']       || '',
      modelo:  r['Modelo']      || '',
      pagado:  r['Pagado por']  || '',
      desc:    r['Descripcion'] || '',
      valor:   parseFloat(r['Valor']) || 0,
    }));

  const sourceTotals = summarize(buildCarsMini(movs));
  console.log('Totales en el Sheet:', sourceTotals);

  if (!WRITE) {
    console.log('Dry-run: no se insertó nada. Corré con --write para migrar de verdad.');
    return;
  }

  const { count: autosExistentes } = await supabase.from('autos').select('*', { count: 'exact', head: true });
  const { count: movsExistentes }  = await supabase.from('movimientos').select('*', { count: 'exact', head: true });
  if ((autosExistentes ?? 0) > 0 || (movsExistentes ?? 0) > 0) {
    console.error('Las tablas ya tienen datos. Abortando para evitar duplicados. Vaciá autos/movimientos en Supabase si querés re-migrar.');
    process.exit(1);
  }

  const autosMap = new Map();
  movs.forEach(m => {
    if (!autosMap.has(m.patente)) autosMap.set(m.patente, { patente: m.patente, marca: m.marca, modelo: m.modelo });
  });

  const { data: autosInsertados, error: errAutos } = await supabase
    .from('autos')
    .insert(Array.from(autosMap.values()))
    .select('id, patente');
  if (errAutos) { console.error('Error insertando autos:', errAutos); process.exit(1); }

  const idPorPatente = new Map(autosInsertados.map(a => [a.patente, a.id]));

  const movsParaInsertar = movs.map(m => ({
    auto_id:     idPorPatente.get(m.patente),
    tipo:        m.tipo,
    fecha:       m.fecha,
    valor:       m.valor,
    pagado_por:  m.pagado,
    descripcion: m.desc,
  }));

  const { error: errMovs } = await supabase.from('movimientos').insert(movsParaInsertar);
  if (errMovs) { console.error('Error insertando movimientos:', errMovs); process.exit(1); }

  console.log(`Insertados ${autosInsertados.length} autos y ${movsParaInsertar.length} movimientos.`);

  const { data: verifRows, error: errVerif } = await supabase
    .from('movimientos')
    .select('tipo, valor, autos(patente, marca, modelo)');
  if (errVerif) { console.error('Error verificando:', errVerif); process.exit(1); }

  const verifMovs    = verifRows.map(r => ({ tipo: r.tipo, valor: r.valor, patente: r.autos.patente, marca: r.autos.marca, modelo: r.autos.modelo }));
  const targetTotals = summarize(buildCarsMini(verifMovs));
  console.log('Totales en Supabase:', targetTotals);

  const coinciden = JSON.stringify(sourceTotals) === JSON.stringify(targetTotals);
  console.log(coinciden ? '✅ VALIDACIÓN OK: los totales coinciden.' : '❌ VALIDACIÓN FALLÓ: los totales no coinciden.');
  if (!coinciden) process.exit(1);
}

main();
