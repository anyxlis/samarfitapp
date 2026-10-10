import { Injectable, inject, signal } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { Empresa, EmpresaService } from './empresa.service';

/** Todo en negro/grises para ahorrar tinta al imprimir */
const NEGRO: [number, number, number] = [20, 20, 20];
const GRIS: [number, number, number] = [95, 95, 95];
const LINEA: [number, number, number] = [175, 175, 175];

export const MARGEN = 12;

export type ModoPdf = 'imprimir' | 'ver' | 'descargar';

export interface OpcionesTabla {
  subtitulo?: string;
  totales?: string[];
  derecha?: number[];          // índices de columnas alineadas a la derecha
  horizontal?: boolean;
}

export interface OpcionesEncabezado {
  /** Línea legal extra bajo el encabezado (ej. resolución DIAN en facturas de venta) */
  leyenda?: string;
}

@Injectable({ providedIn: 'root' })
export class PdfService {
  private readonly empresa = inject(EmpresaService);
  private logo?: Promise<string>;

  /** Qué hacer con el próximo PDF generado (lo fija el botón que el usuario tocó) */
  modo: ModoPdf = 'descargar';
  /** PDF abierto en el visor */
  readonly visor = signal<{ url: string; nombre: string } | null>(null);

  /** Entrega el PDF según el modo: imprimir, ver en pantalla o descargar */
  salida(doc: jsPDF, nombre: string) {
    const archivo = nombre.toLowerCase().endsWith('.pdf') ? nombre : `${nombre}.pdf`;
    doc.setProperties({ title: archivo.replace(/\.pdf$/i, ''), author: 'SamarFit' });
    (doc as any).viewerPreferences?.({ DisplayDocTitle: true });
    if (this.modo === 'descargar') { doc.save(archivo); return; }
    const url = URL.createObjectURL(doc.output('blob'));
    if (this.modo === 'ver') { this.visor.set({ url, nombre: archivo }); return; }
    this.imprimirUrl(url);
  }

  /** Imprime un PDF sin abrir pestañas nuevas (iframe oculto) */
  imprimirUrl(url: string) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    f.src = url;
    f.onload = () => setTimeout(() => {
      try { f.contentWindow?.focus(); f.contentWindow?.print(); }
      catch { window.open(url, '_blank'); }
    }, 150);
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 120000);
  }

  cerrarVisor() {
    const v = this.visor();
    if (v) setTimeout(() => URL.revokeObjectURL(v.url), 1000);
    this.visor.set(null);
  }

  /** Logo convertido a escala de grises (no gasta tinta de color) */
  private cargarLogo(): Promise<string> {
    return (this.logo ??= new Promise<string>((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 200; c.height = 200;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 200, 200);
        ctx.filter = 'grayscale(1) contrast(1.15)';
        ctx.drawImage(img, 0, 0, 200, 200);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = rej;
      img.src = 'logo.png';
    }));
  }

  /** Líneas con los datos legales de la empresa */
  lineasEmpresa(e: Empresa | null): string[] {
    if (!e) return [];
    const nit = e.nit ? `${e.tipo_persona === 'juridica' ? 'NIT' : 'NIT/CC'} ${e.nit}${e.dv ? '-' + e.dv : ''}` : '';
    return [
      [nit, e.regimen, e.responsabilidades && `Resp. ${e.responsabilidades}`, e.actividad_ciiu && `CIIU ${e.actividad_ciiu}`].filter(Boolean).join('  ·  '),
      [e.direccion, e.ciudad].filter(Boolean).join(', '),
      [e.telefono && `Tel. ${e.telefono}`, e.correo, e.sitio_web].filter(Boolean).join('  ·  '),
    ].filter(Boolean);
  }

  /** Encabezado compacto con la información de la empresa; devuelve la Y donde empieza el contenido */
  async encabezado(doc: jsPDF, titulo: string, subtitulo?: string, o: OpcionesEncabezado = {}): Promise<number> {
    const [logo, emp] = await Promise.all([this.cargarLogo().catch(() => null), this.empresa.get().catch(() => null)]);
    const w = doc.internal.pageSize.getWidth();
    const x0 = MARGEN + (logo ? 19 : 0);
    if (logo) doc.addImage(logo, 'JPEG', MARGEN, 8, 16, 16);

    // Empresa (izquierda)
    const razon = emp?.razon_social || emp?.nombre || 'SamarFit';
    doc.setTextColor(...NEGRO).setFont('helvetica', 'bold').setFontSize(10.5).text(razon, x0, 11.5);
    let y = 15.2;
    if (emp?.razon_social && emp.nombre && emp.razon_social !== emp.nombre) {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS).text(emp.nombre, x0, y);
      y += 3.5;
    }
    doc.setFont('helvetica', 'normal').setFontSize(7.3).setTextColor(...GRIS);
    for (const l of this.lineasEmpresa(emp)) { doc.text(l, x0, y, { maxWidth: w - x0 - 62 }); y += 3.3; }

    // Documento (derecha)
    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...NEGRO).text(titulo.toUpperCase(), w - MARGEN, 11.5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS);
    if (subtitulo) doc.setFont('helvetica', 'bold').setTextColor(...NEGRO).text(subtitulo, w - MARGEN, 15.5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GRIS)
      .text(`Generado: ${new Date().toLocaleString('es-CO')}`, w - MARGEN, subtitulo ? 19 : 15.5, { align: 'right' });

    y = Math.max(y, 25) + 0.5;
    doc.setDrawColor(...NEGRO).setLineWidth(0.3).line(MARGEN, y, w - MARGEN, y);
    if (o.leyenda) {
      doc.setFont('helvetica', 'normal').setFontSize(6.8).setTextColor(...GRIS);
      const l = doc.splitTextToSize(o.leyenda, w - 2 * MARGEN);
      doc.text(l, MARGEN, y + 3.2);
      y += l.length * 2.9 + 1;
    }
    return y + 4;
  }

  piePaginas(doc: jsPDF) {
    const n = doc.getNumberOfPages();
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GRIS);
      doc.text(`Página ${i} de ${n}`, w - MARGEN, h - 6, { align: 'right' });
    }
  }

  /** Tablas sin rellenos de color: solo líneas finas */
  estiloTabla() {
    return {
      theme: 'plain' as const,
      styles: { fontSize: 8, cellPadding: { top: 1.3, bottom: 1.3, left: 1.5, right: 1.5 }, textColor: NEGRO,
                lineColor: LINEA, lineWidth: { bottom: 0.1 } },
      headStyles: { fontStyle: 'bold' as const, textColor: NEGRO, lineColor: NEGRO, lineWidth: { bottom: 0.35, top: 0.35 } },
      footStyles: { fontStyle: 'bold' as const, textColor: NEGRO, lineColor: NEGRO, lineWidth: { top: 0.35 } },
      margin: { left: MARGEN, right: MARGEN },
    };
  }

  /** Exporta un listado como PDF con el encabezado de la empresa */
  async tabla(titulo: string, columnas: string[], filas: RowInput[], archivo: string, o: OpcionesTabla = {}) {
    const doc = new jsPDF({ orientation: o.horizontal ? 'landscape' : 'portrait', unit: 'mm', format: 'letter' });
    const y = await this.encabezado(doc, titulo, o.subtitulo);
    const derecha = Object.fromEntries((o.derecha ?? []).map((i) => [i, { halign: 'right' as const }]));
    autoTable(doc, {
      ...this.estiloTabla(),
      startY: y,
      head: [columnas.map((c, i) => ({ content: c, styles: { halign: (o.derecha ?? []).includes(i) ? ('right' as const) : ('left' as const) } }))],
      body: filas,
      foot: o.totales ? [o.totales.map((t, i) => ({ content: t, styles: { halign: (o.derecha ?? []).includes(i) ? ('right' as const) : ('left' as const) } }))] : undefined,
      showFoot: 'lastPage',
      columnStyles: derecha,
    });
    this.piePaginas(doc);
    this.salida(doc, archivo);
  }
}
