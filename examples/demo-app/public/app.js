// Client for the demo users list. Bugs are deliberate; see examples/demo-app/README.md.
const select = document.querySelector('#status');
const tbody = document.querySelector('#users tbody');
const count = document.querySelector('#count');

const STATUS_LABEL = { active: 'Active', disabled: 'Disabled' };

function render(users) {
  tbody.innerHTML = users
    .map(
      (u) =>
        `<tr data-testid="user-row"><td>${u.name}</td><td>${u.email}</td><td>${u.store}</td><td>${STATUS_LABEL[u.status]}</td></tr>`,
    )
    .join('');
  count.textContent = `${users.length} users`;
}

function load(status) {
  const url = new URL(location.href);
  url.searchParams.set('status', status);
  history.replaceState(null, '', url);
  // No request cancellation and no status check: a slow, older response can overwrite
  // a newer one, and an error response is treated as data.
  fetch(`/api/users?status=${status}`)
    .then((res) => res.json())
    .then((data) => render(data.users));
}

select.addEventListener('change', () => load(select.value));

const initial = new URLSearchParams(location.search).get('status') || 'all';
select.value = initial;
load(initial);
