// Menu mobile: abre/fecha ao clicar no botão
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('menu');

toggle.addEventListener('click', () => {
  const open = menu.classList.toggle('is-open');
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
});

// Fecha o menu ao clicar em um link (no celular)
menu.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  });
});

// Ano automático no rodapé
document.getElementById('ano').textContent = new Date().getFullYear();
