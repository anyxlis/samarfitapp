import { Component, ElementRef, ViewChild, computed, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { PdfService } from '../core/pdf.service';

/** Visor de PDF dentro de la app (sin ventanas emergentes) */
@Component({
  selector: 'app-pdf-visor',
  standalone: true,
  template: `
    @if (pdf.visor(); as v) {
      <div class="modal d-block" tabindex="-1" (keydown.escape)="pdf.cerrarVisor()">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-fullscreen-lg-down">
          <div class="modal-content" style="height: 90vh">
            <div class="modal-header py-2">
              <h6 class="modal-title text-truncate flex-grow-1 min-w-0"><i class="bi bi-file-earmark-pdf me-1"></i>{{ v.nombre }}</h6>
              <button class="btn btn-sm btn-outline-dark me-1" (click)="imprimir()"><i class="bi bi-printer me-1"></i>Imprimir</button>
              <a class="btn btn-sm btn-outline-dark me-2" [href]="v.url" [attr.download]="v.nombre"><i class="bi bi-download me-1"></i>Descargar</a>
              <button type="button" class="btn-close" (click)="pdf.cerrarVisor()"></button>
            </div>
            <div class="modal-body p-0 bg-secondary-subtle">
              @if (soportaVisor) {
                <iframe #marco [src]="urlSegura()" title="Vista previa del PDF" class="w-100 h-100 border-0"></iframe>
              } @else {
                <div class="h-100 d-flex flex-column align-items-center justify-content-center text-center p-4">
                  <i class="bi bi-file-earmark-pdf fs-1 mb-2"></i>
                  <p class="mb-3">Este dispositivo no muestra PDF dentro de la página.</p>
                  <a class="btn btn-primary" [href]="v.url" target="_blank" rel="noopener">Abrir PDF</a>
                </div>
              }
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
})
export class PdfVisorComponent {
  readonly pdf = inject(PdfService);
  private readonly san = inject(DomSanitizer);
  @ViewChild('marco') marco?: ElementRef<HTMLIFrameElement>;

  /** Los navegadores de celular normalmente no muestran PDF en un iframe */
  readonly soportaVisor = (navigator as any).pdfViewerEnabled !== false && !/Android|iPhone|iPad/i.test(navigator.userAgent);

  readonly urlSegura = computed(() => {
    const v = this.pdf.visor();
    return v ? this.san.bypassSecurityTrustResourceUrl(v.url) : null;
  });

  imprimir() {
    const w = this.marco?.nativeElement.contentWindow;
    if (w) { w.focus(); w.print(); return; }
    const v = this.pdf.visor();
    if (v) this.pdf.imprimirUrl(v.url);
  }
}
