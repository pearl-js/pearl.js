import { describe, it, expect } from 'vitest'
import { parseDotenv } from './Config.js'

describe('parseDotenv', () => {
    it('parses simple KEY=VALUE pairs', () => {
        expect(parseDotenv('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('skips blank lines and comments', () => {
        const src = `
# heading
FOO=bar

# another
BAZ=qux
`
        expect(parseDotenv(src)).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('strips matching double quotes and handles escapes', () => {
        const src = `MSG="hello\\nworld"\nQUOTE="say \\"hi\\""`
        expect(parseDotenv(src)).toEqual({
            MSG: 'hello\nworld',
            QUOTE: 'say "hi"',
        })
    })

    it('preserves single-quoted values literally (no escape processing)', () => {
        const src = `RAW='a\\nb'`
        expect(parseDotenv(src)).toEqual({ RAW: 'a\\nb' })
    })

    it('supports multi-line quoted values', () => {
        const src = `KEY="line one\nline two"`
        expect(parseDotenv(src)).toEqual({ KEY: 'line one\nline two' })
    })

    it('keeps equals signs inside values', () => {
        expect(parseDotenv('CONN=postgres://u:p@h/d?ssl=true')).toEqual({
            CONN: 'postgres://u:p@h/d?ssl=true',
        })
    })

    it('honors the `export` prefix', () => {
        expect(parseDotenv('export FOO=bar')).toEqual({ FOO: 'bar' })
    })

    it('strips trailing comments on unquoted values', () => {
        expect(parseDotenv('FOO=bar # trailing')).toEqual({ FOO: 'bar' })
    })

    it('ignores malformed keys', () => {
        expect(parseDotenv('123BAD=x\nGOOD=y')).toEqual({ GOOD: 'y' })
    })
})
