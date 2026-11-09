import { add } from './companies.js';

const template = window.ORBIA_CONFIG?.templateUrl;
const link = document.getElementById('template');
if (template && /^https:\/\/script\.google\.com\//.test(template)) link.href = template;
else document.getElementById('template-slot').textContent = 'Le modèle n’est pas encore publié. Demandez le lien à l’administrateur d’Orbia.';

document.getElementById('open').addEventListener('click', () => {
  try {
    add(document.getElementById('server').value, 'Ma société');
    location.href = './#/';
  } catch (err) {
    document.getElementById('message').textContent = err.message;
  }
});
