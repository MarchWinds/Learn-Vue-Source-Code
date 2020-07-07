/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor(value: any) {
    this.value = value
    this.dep = new Dep()
    this.vmCount = 0
    def(value, '__ob__', this)
    if (Array.isArray(value)) {
      if (hasProto) {
        protoAugment(value, arrayMethods)
      } else {
        copyAugment(value, arrayMethods, arrayKeys)
      }
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
//直接通过原型指向的方式
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
// 通过数据代理的方式
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  //如果存在__ob__属性，说明该对象已经observe过
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value)
  }
  // 如果是RootData，即咱们在新建Vue实例时，传到data里的值，只有RootData在每次observe的时候，会进行计数。
  // vmCount是用来记录此Vue实例被使用的次数的，
  // 比如，我们有一个组件logo，页面头部和尾部都需要展示logo，都用了这个组件，那么这个时候vmCount就会计数，值为2
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }
  // 是否需要深度响应，不需要的话就不去调用observe去递归响应
  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      //获取属性的值，如果这个属性在转化之前定义过getter，那么调用该getter得到value的值，否则直接返回val。
      const value = getter ? getter.call(obj) : val
      // 注意这里，这里是Dep收集订阅者的过程，只有在Dep.target存在的情况下才进行这个操作，在Watcher收集依赖的时候才会设置Dep.target，所以Watcher收集依赖的时机就是Dep收集订阅者的时机。
      // 调用get的情况有两种，一是Watcher收集依赖的时候（此时Dep收集订阅者），二是模板或js代码里用到这个值，这个时候是不需要收集依赖的，只要返回值就可以了。
      if (Dep.target) {
        dep.depend()
        //注意这里,不仅这个属性需要添加到依赖列表中，如果这个属性对应的值是对象或数组，那么这个属性对应的值也需要添加到依赖列表中，原因后面详细解释
        if (childOb) {
          childOb.dep.depend()
          //如果是数组，那么数组中的每个值都添加到依赖列表里
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      // 拿到旧值，原来有getter调用原来的getter，没有就把传入的val当做旧值
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 判断是否相等或者都是NaN
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // 有getter但是没有setter的直接return 不设置值
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      // 如果原先的setter存在则调用赋值，不存在getter也不存在setter则直接改变val的值（不明白使用场景）
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      // 当为属性设置了新的值，是需要observe的
      childOb = !shallow && observe(newVal)
      // 通知更新数据
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 * 在对象上设置属性。添加新属性，如果该属性尚不存在，则触发更改通知。
 * 如：
 * let obj={}
 * vm.$set(obj，'nane'，"小明")
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  // 判断target是否为undefined、null或原始类型
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target)}`)
  }
  /**
   * 判断targrt是否为数组并且key是否是一个有效的索引,如果是，
   * 则取target.length与key两者的最大值赋给target.length
   * 然后通过数组的splice方法将val添加到key索引处
   */
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  // 不是数组，即认为是对象
  /**
   * 判断key是否已经存在与对象中
   * 若存在，表示只是简单的修改对象中的属性，
   * 则直接使用target[key]=val修改即可
   */
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  /**
   * 获取target的ob_属性，并判断target是不是vue实例以及是否为根数据对象
   * 如果是，则报出警告并终止运行
   */
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  /**
   * 判断target的_ob属性是否存在，_ob属性的存在与否标志target是否是一个响应式数据若_ob属性
   * 不存在，表示target不是一个响应式对象，那么仅需修改属性即可，不需要触发视图更新通知
   */
  if (!ob) {
    target[key] = val
    return val
  }
  /**
   * 若ob属性存在，表示target是一个响应式对象，
   * 那么使用defineReactive(ob.value，key，val)将key和val添加到target上，并将其设置为响应式
   * 最后触发视图更新通知
   */
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    // 在调用这个函数的时候，数组已经被observe过了，且会递归observe。(看上面defineReactive函数里的这行代码：var childOb = observe(val);)
    // 所以正常情况下都会存在__ob__属性，这个时候就可以调用dep添加依赖了。
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
