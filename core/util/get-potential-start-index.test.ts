import { getPotentialStartIndex } from './get-potential-start-index'

describe('getPotentialStartIndex', () => {
  it('should return null when searchedText is empty', () => {
    const result = getPotentialStartIndex('1234567890', '')
    expect(result).toBeNull()
  })

  it('should return null when searchedText is not in text', () => {
    const result = getPotentialStartIndex('1234567890', 'a')
    expect(result).toBeNull()
  })

  it('should return index when searchedText is in text', () => {
    const result = getPotentialStartIndex('1234567890', '1234567890')
    expect(result).toBe(0)
  })

  it('should return index when searchedText might start in text', () => {
    const result1 = getPotentialStartIndex('1234567890', '0123')
    expect(result1).toBe(9)

    const result2 = getPotentialStartIndex('1234567890', '90123')
    expect(result2).toBe(8)

    const result3 = getPotentialStartIndex('1234567890', '890123')
    expect(result3).toBe(7)
  })
})
