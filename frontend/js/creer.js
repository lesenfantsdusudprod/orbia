import { add } from './companies.js';

document.getElementById('client-id').textContent = window.ORBIA_CONFIG?.googleClientId || 'introuvable : rechargez la page';
document.getElementById('open').addEventListener('click', () => {
  const message = document.getElementById('message');
  try {
    add(document.getElementById('server').value, 'Ma société');
    location.href = './#/';
  } catch (err) {
    message.textContent = err.message;
  }
});
