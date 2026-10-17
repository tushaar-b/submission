import{describe,it,expect}from'vitest';
import{parseIndiaBbox}from'./india';

describe('India aircraft viewport validation',()=>{
  it('accepts current Delhi viewport and the former Delhi bounds',()=>{
    expect(parseIndiaBbox('27,76,29,79')).toEqual([27,76,29,79]);
    expect(parseIndiaBbox('27.4,75.9,30.2,78.8')).toEqual([27.4,75.9,30.2,78.8]);
  });
  it('rejects malformed, reversed, outside-India, and overly broad bounds',()=>{
    for(const value of ['', 'a,76,29,79', '29,76,27,79', '27,79,29,76', '1,101,2,103', '10,70,22,80', '27,76,29'])expect(parseIndiaBbox(value)).toBeNull();
    expect(parseIndiaBbox(undefined)).toBeNull();
  });
});
