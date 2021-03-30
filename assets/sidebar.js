window.addEventListener('load', () => {
  // Allow the user to toggle the sidebar
  document.getElementById('sidebar-toggle-button').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const collapseButton = document.getElementById('sidebar-toggle-button');
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      return collapseButton.innerText = '↪';
    }
    sidebar.classList.add('collapsed');
    collapseButton.innerText = '↩';
  });
});