/**
 * sidebarToggle.test.js — Invariant Tests for TopBar Hamburger Sidebar Toggle & Middle Button Removal.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(import.meta.dirname, '..');

describe('Sidebar Hamburger Toggle & Removal of Middle Button Invariants', () => {
  test('1. Sidebar.js source code has removed the middle .sidebar__collapse-toggle button', () => {
    const sidebarJsPath = path.join(clientRoot, 'src', 'components', 'shell', 'Sidebar.js');
    const content = fs.readFileSync(sidebarJsPath, 'utf8');

    assert.doesNotMatch(
      content,
      /sidebar__collapse-toggle/,
      'Sidebar.js must not contain sidebar__collapse-toggle'
    );
    assert.match(
      content,
      /nav\.id\s*=\s*['"]sidebar-nav['"]/,
      'Sidebar.js must give the primary nav element id="sidebar-nav"'
    );
  });

  test('2. TopBar.js source code renders hamburger icon button before the brand logo', () => {
    const topBarJsPath = path.join(clientRoot, 'src', 'components', 'shell', 'TopBar.js');
    const content = fs.readFileSync(topBarJsPath, 'utf8');

    assert.match(
      content,
      /topbar__sidebar-toggle/,
      'TopBar.js must create .topbar__sidebar-toggle'
    );
    assert.match(
      content,
      /ICONS\.menu/,
      'TopBar.js must use ICONS.menu for the hamburger button'
    );

    const toggleIdx = content.indexOf('sidebarToggleBtn');
    const brandIdx = content.indexOf("const brand = document.createElement('a')");
    assert.ok(
      toggleIdx !== -1 && brandIdx !== -1 && toggleIdx < brandIdx,
      'sidebarToggleBtn must be declared and appended before the brand link'
    );
  });

  test('3. icons.js defines menu hamburger vector in ICONS', () => {
    const iconsJsPath = path.join(clientRoot, 'src', 'components', 'ui', 'icons.js');
    const content = fs.readFileSync(iconsJsPath, 'utf8');

    assert.match(
      content,
      /menu:\s*svg\(/,
      'icons.js must export menu SVG in ICONS'
    );
  });

  test('4. shell.css defines styles for .topbar__sidebar-toggle', () => {
    const shellCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'shell.css');
    const content = fs.readFileSync(shellCssPath, 'utf8');

    assert.match(
      content,
      /\.topbar__sidebar-toggle\s*\{/,
      'shell.css must define styles for .topbar__sidebar-toggle'
    );
  });

  test('5. AppShell passes sidebarCollapsed and onToggleSidebar to TopBar', () => {
    const appShellJsPath = path.join(clientRoot, 'src', 'components', 'shell', 'AppShell.js');
    const content = fs.readFileSync(appShellJsPath, 'utf8');

    assert.match(
      content,
      /onToggleSidebar:/,
      'AppShell.js must pass onToggleSidebar callback to renderTopBar'
    );
    assert.match(
      content,
      /toggleSidebarCollapsed/,
      'AppShell.js must invoke toggleSidebarCollapsed'
    );
  });
});
