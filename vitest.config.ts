import {defineConfig} from 'vitest/config'

// Fixed zone with DST so midnight/DST tests are deterministic on any machine.
process.env.TZ = 'America/New_York'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
