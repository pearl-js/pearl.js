import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findBootstrap, bootstrapSpecifier } from './run-in-project.js'

let project: string

beforeEach(() => {
    project = mkdtempSync(path.join(tmpdir(), 'pearl-cli-'))
    mkdirSync(path.join(project, 'src'), { recursive: true })
})

afterEach(() => {
    rmSync(project, { recursive: true, force: true })
})

describe('findBootstrap', () => {
    it('returns null when the project has none', () => {
        expect(findBootstrap(project)).toBeNull()
    })

    it('finds src/bootstrap.ts', () => {
        const file = path.join(project, 'src/bootstrap.ts')
        writeFileSync(file, 'export async function bootstrap() {}')
        expect(findBootstrap(project)).toBe(file)
    })

    it('finds a compiled src/bootstrap.js', () => {
        const file = path.join(project, 'src/bootstrap.js')
        writeFileSync(file, 'export async function bootstrap() {}')
        expect(findBootstrap(project)).toBe(file)
    })

    it('prefers the TypeScript source over the build output', () => {
        writeFileSync(path.join(project, 'src/bootstrap.js'), '')
        writeFileSync(path.join(project, 'src/bootstrap.ts'), '')
        expect(findBootstrap(project)).toBe(path.join(project, 'src/bootstrap.ts'))
    })
})

describe('bootstrapSpecifier', () => {
    // The generated script lives in node_modules/.pearl so the app's own
    // dependencies resolve; the bootstrap import has to climb back out.
    it('is relative to node_modules/.pearl', () => {
        const spec = bootstrapSpecifier(path.join(project, 'src/bootstrap.ts'), project)
        expect(spec).toBe('../../src/bootstrap.ts')
    })

    it('always produces a relative specifier, never a bare one', () => {
        const spec = bootstrapSpecifier(path.join(project, 'bootstrap.ts'), project)
        expect(spec.startsWith('.')).toBe(true)
    })

    it('uses forward slashes regardless of platform separator', () => {
        const spec = bootstrapSpecifier(path.join(project, 'src/bootstrap.ts'), project)
        expect(spec).not.toContain('\\')
    })
})
