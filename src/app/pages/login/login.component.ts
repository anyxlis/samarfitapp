import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="sf-login">
      <form class="sf-login-card" (ngSubmit)="entrar()" #f="ngForm">
        <img src="logo.png" alt="SamarFit by Sandra Cochet" />
        <p class="text-center text-muted mb-4">Control de inventario y ventas</p>

        <div class="form-floating mb-3">
          <input class="form-control" type="email" name="email" id="email" placeholder="Correo" [(ngModel)]="email" required autocomplete="username" />
          <label for="email">Correo</label>
        </div>
        <div class="input-group mb-3">
          <div class="form-floating flex-grow-1">
            <input class="form-control" [type]="ver() ? 'text' : 'password'" name="pass" id="pass" placeholder="Contraseña" [(ngModel)]="password" required autocomplete="current-password" />
            <label for="pass">Contraseña</label>
          </div>
          <button class="btn btn-outline-secondary" type="button" (click)="ver.set(!ver())" aria-label="Mostrar contraseña">
            <i class="bi" [class]="ver() ? 'bi-eye-slash' : 'bi-eye'"></i>
          </button>
        </div>

        @if (error()) { <div class="alert alert-danger py-2 small">{{ error() }}</div> }

        <button class="btn btn-primary w-100 py-2" type="submit" [disabled]="cargando() || f.invalid">
          @if (cargando()) { <span class="spinner-border spinner-border-sm me-2"></span> }Ingresar
        </button>
      </form>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  email = '';
  password = '';
  readonly ver = signal(false);
  readonly cargando = signal(false);
  readonly error = signal('');

  async entrar() {
    this.error.set('');
    this.cargando.set(true);
    try {
      await this.auth.signIn(this.email.trim(), this.password);
      this.router.navigateByUrl('/dashboard');
    } catch {
      this.error.set('Correo o contraseña incorrectos.');
    } finally {
      this.cargando.set(false);
    }
  }
}
