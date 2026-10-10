import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-pronto',
  standalone: true,
  template: `
    <h2 class="mb-3">{{ titulo }}</h2>
    <div class="card"><div class="card-body text-muted">Este módulo se construye en el siguiente paso.</div></div>
  `,
})
export class ProntoComponent {
  titulo = inject(ActivatedRoute).snapshot.data['titulo'];
}
