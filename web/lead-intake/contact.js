// Lead form: inline field errors, then POST /api/lead as JSON.
const form = document.getElementById('lead-form');

if (form) {
  const button = document.getElementById('submit');
  const status = document.getElementById('status');
  const label = button.textContent;

  const messages = {
    name: 'Enter your name.',
    email: 'Enter a valid email address.',
    company: 'Enter your company name.',
    companySize: 'Choose a company size.',
    budget: 'Choose a budget.',
    timeline: 'Choose a timeline.',
    consent: 'Tick the box so we may contact you.',
  };

  function show(message, kind) {
    status.textContent = message;
    status.className = kind;
  }

  function setError(field, text) {
    const error = document.getElementById(`${field.name}-error`);
    if (!error) return;
    error.textContent = text;
    error.hidden = !text;
    if (text) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }

  function check(field) {
    const ok = field.checkValidity() && (field.type !== 'text' || field.value.trim() !== '' || !field.required);
    setError(field, ok ? '' : messages[field.name]);
    return ok;
  }

  const required = [...form.elements].filter((el) => el.required);

  required.forEach((field) => {
    field.addEventListener('blur', () => { if (field.value !== '' || field.type === 'checkbox') check(field); });
    field.addEventListener('input', () => { if (field.getAttribute('aria-invalid')) check(field); });
    field.addEventListener('change', () => { if (field.getAttribute('aria-invalid')) check(field); });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    show('', '');

    const failed = required.filter((field) => !check(field));
    if (failed.length) {
      failed[0].focus();
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    data.consent = form.elements.consent.checked;

    button.disabled = true;
    button.textContent = 'Sending…';

    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        form.reset();
        show('Thanks. We will reply within one business day.', 'success');
      } else {
        show(result.error || 'Something went wrong. Please try again.', 'error');
      }
    } catch (err) {
      show('Network error. Check your connection and try again.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}
