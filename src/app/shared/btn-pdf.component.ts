import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { ModoPdf, PdfService } from '../core/pdf.service';

/** Botones Imprimir · Ver · Descargar para cualquier PDF */
@Component({
  selector: 'app-btn-pdf',
  standalone: true,
  template: `
    <div class="btn-group" role="group" aria-label="PDF">
      @for (b of botones; track b.modo) {
        <button type="button" class="btn btn-outline-dark" [class.btn-sm]="compacto" [disabled]="disabled"
                [title]="b.texto" (click)="ir(b.modo)">
          <i class="bi bi-{{ b.icono }}"></i>
          @if (!compacto) { <span class="d-none d-xl-inline ms-1">{{ b.texto }}</span> }
        </button>
      }
    </div>
  `,
})
export class BtnPdfComponent {
  @Input() disabled = false;
  @Input() compacto = false;
  @Output() generar = new EventEmitter<void>();
  private readonly pdf = inject(PdfService);

  readonly botones: { modo: ModoPdf; texto: string; icono: string }[] = [
    { modo: 'imprimir', texto: 'Imprimir', icono: 'printer' },
    { modo: 'ver', texto: 'Ver PDF', icono: 'eye' },
    { modo: 'descargar', texto: 'Descargar PDF', icono: 'download' },
  ];

  ir(modo: ModoPdf) {
    this.pdf.modo = modo;
    this.generar.emit();
  }
}
