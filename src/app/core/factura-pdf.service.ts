import { Injectable, inject } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MARGEN, PdfService } from './pdf.service';
import { EmpresaService, textoResolucion } from './empresa.service';
import { cop, fechaCorta } from '../shared/format';
import { ConfigFactura, ESTADOS, FacturaDetalle, descripcionVariante, nombreMetodo } from '../pages/facturas/factura.config';

@Injectable({ providedIn: 'root' })
export class FacturaPdfService {
  private readonly pdf = inject(PdfService);
  private readonly empresa = inject(EmpresaService);

  async descargar(cfg: ConfigFactura, f: FacturaDetalle) {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const w = doc.internal.pageSize.getWidth();
    const emp = await this.empresa.get().catch(() => null);
    const esVenta = cfg.tipo === 'venta';
    let y = await this.pdf.encabezado(doc, cfg.titulo, `No. ${f.numero}`, { leyenda: esVenta ? textoResolucion(emp) : '' });

    // ---- Adquirente / proveedor y datos del documento (recuadro solo con línea) ----
    const t = f.tercero;
    const izq = [
      t.nombre,
      t.documento ? `${t.tipo_documento} ${t.documento}` : '',
      [t.direccion, t.ciudad].filter(Boolean).join(', '),
      [t.telefono, t.correo].filter(Boolean).join('  ·  '),
    ].filter(Boolean);
    const der: [string, string][] = [
      ['Fecha de expedición', fechaCorta(f.fecha)],
      ['Forma de pago', f.forma_pago === 'credito' ? 'Crédito' : 'Contado'],
      ...(f.fecha_vencimiento ? [['Vencimiento', fechaCorta(f.fecha_vencimiento)] as [string, string]] : []),
      ...(f.numero_proveedor ? [['Factura proveedor', f.numero_proveedor] as [string, string]] : []),
      ['Estado', ESTADOS[f.estado]?.texto ?? f.estado],
    ];
    const alto = Math.max(izq.length, der.length) * 3.6 + 6;
    doc.setDrawColor(170).setLineWidth(0.2).rect(MARGEN, y, w - 2 * MARGEN, alto);
    doc.line(w / 2 + 8, y, w / 2 + 8, y + alto);
    doc.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(110);
    doc.text(esVenta ? 'CLIENTE / ADQUIRENTE' : 'PROVEEDOR', MARGEN + 2, y + 3.4);
    izq.forEach((l, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal').setFontSize(i === 0 ? 8.8 : 7.8).setTextColor(20);
      doc.text(l, MARGEN + 2, y + 7.2 + i * 3.6, { maxWidth: w / 2 - MARGEN - 2 });
    });
    der.forEach(([k, v], i) => {
      doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(110).text(k, w / 2 + 10, y + 4 + i * 3.6);
      doc.setTextColor(20).text(v, w - MARGEN - 2, y + 4 + i * 3.6, { align: 'right' });
    });
    y += alto + 4;

    // ---- Detalle ----
    const precio = (i: any) => Number(i[cfg.campoPrecio]);
    autoTable(doc, {
      ...this.pdf.estiloTabla(),
      startY: y,
      head: [['#', 'Código', 'Descripción', { content: 'Cant.', styles: { halign: 'center' } }, { content: cfg.precio, styles: { halign: 'right' } }, { content: 'Subtotal', styles: { halign: 'right' } }]],
      body: f.items.map((i, n) => [String(n + 1), i.variante.sku, descripcionVariante(i.variante), String(i.cantidad), cop(precio(i)), cop(i.subtotal)]),
      columnStyles: { 0: { cellWidth: 7 }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    y = (doc as any).lastAutoTable.finalY + 3;

    // ---- Totales (derecha) y notas (izquierda) ----
    const saldo = Number(f.total) - Number(f.pagado);
    const tot: [string, string, boolean?][] = [
      ['Subtotal', cop(f.subtotal)],
      ...(Number(f.descuento) > 0
        ? [[`Descuento${f.descuento_tipo === 'porcentaje' ? ` (${Number(f.descuento_valor)}%)` : ''}`, `- ${cop(f.descuento)}`] as [string, string]]
        : []),
      ...(esVenta && emp?.regimen ? [['IVA', emp.regimen.toLowerCase().includes('no responsable') ? 'No aplica' : cop(0)] as [string, string]] : []),
      ['TOTAL', cop(f.total), true],
      ...(f.estado !== 'anulada' ? [['Pagado', cop(f.pagado)] as [string, string], ['Saldo', cop(saldo), true] as [string, string, boolean]] : []),
    ];
    const xT = w - MARGEN - 62;
    tot.forEach(([k, v, fuerte], i) => {
      const yy = y + 3.5 + i * 4.4;
      if (fuerte) doc.setDrawColor(20).setLineWidth(0.25).line(xT, yy - 3.2, w - MARGEN, yy - 3.2);
      doc.setFont('helvetica', fuerte ? 'bold' : 'normal').setFontSize(fuerte ? 9 : 8).setTextColor(20);
      doc.text(k, xT, yy);
      doc.text(v, w - MARGEN, yy, { align: 'right' });
    });
    const finTot = y + tot.length * 4.4 + 3;

    let yIzq = y + 3.5;
    const anchoIzq = xT - MARGEN - 6;
    const bloque = (titulo: string, texto: string) => {
      doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(110).text(titulo, MARGEN, yIzq);
      const l = doc.setFont('helvetica', 'normal').setFontSize(7.6).setTextColor(40).splitTextToSize(texto, anchoIzq);
      doc.text(l, MARGEN, yIzq + 3.3);
      yIzq += 3.3 + l.length * 3.2 + 2.5;
    };
    bloque('VALOR EN LETRAS', `${enLetras(Number(f.total))} pesos M/CTE.`);
    if (f.pagos.length) {
      bloque(`${cfg.pago.toUpperCase()}S`, f.pagos.map((p) =>
        `${fechaCorta(p.fecha)} · ${nombreMetodo(p.metodo)}${p.referencia ? ' (' + p.referencia + ')' : ''}: ${cop(p.valor)}`).join('\n'));
    }
    if (f.notas) bloque('NOTAS', f.notas);
    y = Math.max(finTot, yIzq) + 2;

    // ---- Factura electrónica (cuando se integre) ----
    if (esVenta && (f as any).cufe) {
      doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(110).text('CUFE', MARGEN, y);
      doc.setFont('courier', 'normal').setFontSize(6.5).setTextColor(40).text(doc.splitTextToSize((f as any).cufe, w - 2 * MARGEN), MARGEN, y + 3);
      y += 9;
    }

    // ---- Pie ----
    if (esVenta && emp?.pie_factura) {
      doc.setFont('helvetica', 'italic').setFontSize(7.8).setTextColor(90).text(emp.pie_factura, w / 2, y + 2, { align: 'center' });
    }

    if (f.estado === 'anulada') {
      doc.setFont('helvetica', 'bold').setFontSize(60).setTextColor(225);
      doc.text('ANULADA', w / 2, 140, { align: 'center', angle: 30 });
    }

    this.pdf.piePaginas(doc);
    this.pdf.salida(doc, `${f.numero}.pdf`);
  }
}

/** Convierte un valor entero a letras en español (ej. 125000 -> "Ciento veinticinco mil") */
export function enLetras(n: number): string {
  n = Math.round(n);
  if (n === 0) return 'Cero';
  const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce',
    'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro',
    'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  const cientos = (x: number): string => {
    if (x === 100) return 'cien';
    const c = Math.floor(x / 100), r = x % 100;
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' y ' + U[r % 10] : '');
    return [C[c], dec].filter(Boolean).join(' ');
  };
  const apocope = (t: string) => t.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
  const miles = (x: number): string => {
    const m = Math.floor(x / 1000), r = x % 1000;
    const pm = m === 0 ? '' : m === 1 ? 'mil' : apocope(cientos(m)) + ' mil';
    return [pm, cientos(r)].filter(Boolean).join(' ');
  };
  const mill = Math.floor(n / 1_000_000), resto = n % 1_000_000;
  const pm = mill === 0 ? '' : mill === 1 ? 'un millón' : apocope(miles(mill)) + ' millones';
  const txt = [pm, miles(resto)].filter(Boolean).join(' ') + (resto === 0 && mill > 0 ? ' de' : '');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
