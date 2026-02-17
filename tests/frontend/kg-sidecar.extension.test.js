import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..');
const extensionDir = path.join(repoRoot, 'public', 'scripts', 'extensions', 'kg-sidecar');

describe('kg-sidecar extension package', () => {
    test('manifest declares generate interceptor and assets', () => {
        const manifestPath = path.join(extensionDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        expect(manifest.display_name).toBe('KG Sidecar');
        expect(manifest.generate_interceptor).toBe('kg_sidecar_generate_interceptor');
        expect(manifest.js).toBe('index.js');
        expect(manifest.css).toBe('style.css');
    });

    test('settings template exposes Neo4j fields', () => {
        const template = fs.readFileSync(path.join(extensionDir, 'settings.html'), 'utf8');
        expect(template).toContain('kg_sidecar_enabled');
        expect(template).toContain('kg_sidecar_db_profile_select');
        expect(template).toContain('kg_sidecar_db_profile_create');
        expect(template).toContain('kg_sidecar_db_profile_delete');
        expect(template).toContain('kg_sidecar_db_clear_current');
        expect(template).toContain('kg_sidecar_db_bind_current');
        expect(template).toContain('kg_sidecar_db_unbind_current');
        expect(template).toContain('kg_sidecar_db_binding_status');
        expect(template).toContain('kg_sidecar_db_provider');
        expect(template).toContain('kg_sidecar_db_uri');
        expect(template).toContain('kg_sidecar_db_name');
        expect(template).toContain('kg_sidecar_db_user');
        expect(template).toContain('kg_sidecar_db_password');
        expect(template).toContain('kg_sidecar_model_fields');
        expect(template).toContain('kg_sidecar_refresh_models');
    });

    test('extension script supports per-session db binding state', () => {
        const script = fs.readFileSync(path.join(extensionDir, 'index.js'), 'utf8');
        expect(script).toContain('dbProfiles');
        expect(script).toContain('conversationDbBindings');
        expect(script).toContain('kg_sidecar_db_bind_current');
        expect(script).toContain('/api/kg-sidecar/db/clear');
        expect(script).toContain('kg_sidecar_db_clear_current');
    });

    test('db action buttons override global menu_button min-content width', () => {
        const style = fs.readFileSync(path.join(extensionDir, 'style.css'), 'utf8');
        expect(style).toContain('.kg-sidecar-db-profile-row .menu_button');
        expect(style).toContain('white-space: nowrap');
        expect(style).toContain('width: fit-content');
    });

    test('refresh model button overrides global menu_button min-content width', () => {
        const style = fs.readFileSync(path.join(extensionDir, 'style.css'), 'utf8');
        expect(style).toContain('#kg_sidecar_refresh_models');
        expect(style).toContain('white-space: nowrap');
        expect(style).toContain('writing-mode: horizontal-tb');
    });
});
