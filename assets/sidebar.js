window.addEventListener('load', () => {
  // Allow the user to toggle the sidebar
  document.getElementById('sidebar-toggle-button').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('collapsed')) {
      return sidebar.classList.remove('collapsed');
    }
    sidebar.classList.add('collapsed');
  });
});