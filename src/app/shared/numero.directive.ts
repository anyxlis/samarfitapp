import { Directive, ElementRef, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Campo numérico digitado (sin flechas ni rueda) con separador de miles.
 * Uso: <input appNumero [(ngModel)]="valor" />
 */
@Directive({
  selector: 'input[appNumero]',
  standalone: true,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => NumeroDirective), multi: true }],
  host: {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    class: 'text-end',
    '(input)': 'alEscribir($any($event.target).value)',
    '(blur)': 'onTouched()',
    '(focus)': '$any($event.target).select()',
  },
})
export class NumeroDirective implements ControlValueAccessor {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (v: number | null) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    this.el.nativeElement.value = v === null || v === undefined || v === '' ? '' : this.fmt(Number(v));
  }
  registerOnChange(fn: (v: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.el.nativeElement.disabled = d; }

  alEscribir(raw: string) {
    const digitos = raw.replace(/\D/g, '');
    const n = digitos ? Number(digitos) : null;
    this.el.nativeElement.value = n === null ? '' : this.fmt(n);
    this.onChange(n);
  }

  private fmt(n: number) { return Math.round(n).toLocaleString('es-CO'); }
}
