import { of } from 'rxjs'
import FINANCE_VAULT_ABI from '../abi/finance-vault'
import { addressesEqual } from '../utils/web3'
import app from './app'
import {
  getEmployeeById,
  getEmployeeByAddress,
  getSalaryAllocation,
} from './employees'
import { getTokenDetails } from './tokens'
import { payment, time } from './marshalling'

const INITIALIZATION_TRIGGER = Symbol('INITIALIZATION_TRIGGER')

const EVENT_MAPPING = {
  INITIALIZATION_TRIGGER: onInit,
  AddEmployee: onAddEmployee,
  TerminateEmployee: onTerminateEmployee,
  SetEmployeeSalary: onSetEmployeeSalary,
  AddEmployeeAccruedSalary: onAddEmployeeAccruedSalary,
  AddEmployeeBonus: onAddEmployeeBonus,
  AddEmployeeReimbursement: onAddEmployeeReimbursement,
  ChangeAddressByEmployee: onChangeAddressByEmployee,
  DetermineAllocation: onDetermineAllocation,
  SendPayment: onSendPayroll,
  AddAllowedToken: onAddAllowedToken,
  SetPriceFeed: onSetPriceFeed,
  SetRateExpiryTime: onSetRateExpiryTime,
}

export default function initialize() {
  return app.store(
    async (state, eventData) => {
      const { event } = eventData
      const eventProcessor = (event && EVENT_MAPPING[event]) || (state => state)

      try {
        const newState = await eventProcessor({ ...state }, eventData)

        return newState
      } catch (err) {
        console.error(`Error occurred processing '${event}' event`, err)
      }

      return state
    },
    [of({ event: INITIALIZATION_TRIGGER })]
  )
}

async function onInit(state) {
  const financeAddress = await app.call('finance').toPromise()
  const denominationTokenAddress = await app
    .call('denominationToken')
    .toPromise()
  const priceFeedAddress = await app.call('feed').toPromise()
  const rateExpiryTime = await app.call('rateExpiryTime').toPromise()

  const vaultAddress = await app
    .external(financeAddress, FINANCE_VAULT_ABI)
    .vault()
    .toPromise()
  const denominationToken = await getTokenDetails(denominationTokenAddress)

  return {
    ...state,
    financeAddress,
    vaultAddress,
    denominationToken,
    priceFeedAddress,
    rateExpiryTime: time(rateExpiryTime),
  }
}

// Employee-related handlers
async function onAddEmployee(state, event) {
  const transform = (employees, employeeIndex, employee) => {
    if (employeeIndex === -1) {
      employees.push(employee)
    } else {
      employees[employeeIndex] = {
        ...employees[employeeIndex],
        ...employee,
      }
    }
  }

  const employees = updateEmployees(state, event, transform)

  return { ...state, employees }
}

async function onTerminateEmployee(state, event) {
  const { employeeId, ...newDataForEmployee } = event.returnValues

  const employees = updateEmployees(
    state.employees,
    employeeId,
    newDataForEmployee,
    (employees, employeeIndex, employee) => {
      if (employeeIndex === -1) {
        employees.push(employee)
      } else {
        employees[employeeIndex] = {
          ...employees[employeeIndex],
          ...employee,
        }
      }
    }
  )
  const employeeIndex = emp
  const employees = await updateEmployeeById(state, event)
  return { ...state, employees }
}

async function onSetEmployeeSalary(state, event) {
  const employees = await updateEmployeeById(state, event)
  return { ...state, employees }
}

async function onAddEmployeeAccruedSalary(state, event) {
  const employees = await updateEmployeeById(state, event)
  return { ...state, employees }
}

async function onChangeAddressByEmployee(state, event) {
  const {
    returnValues: { newAddress: accountAddress },
  } = event
  const { tokens = [], employees = [] } = state
  let salaryAllocation = []

  const employee = employees.find(
    employee => employee.accountAddress === accountAddress
  )

  if (employee) {
    salaryAllocation = await getSalaryAllocation(employee.id, tokens)
  }

  return { ...state, accountAddress, salaryAllocation }
}

async function onDetermineAllocation(state, event) {
  const {
    returnValues: { employee: accountAddress },
  } = event
  const { tokens = [], employees = [] } = state
  let salaryAllocation = []

  const employee = employees.find(
    employee => employee.accountAddress === accountAddress
  )

  if (employee) {
    salaryAllocation = await getSalaryAllocation(employee.id, tokens)
  }

  return { ...state, salaryAllocation }
}

async function onSendPayroll(state, event) {
  const employees = await updateEmployeeByAddress(state, event)
  const { tokens } = state
  const {
    returnValues: { token },
    transactionHash,
  } = event
  const payments = state.payments || []

  const paymentExists = payments.some(payment => {
    const { transactionAddress, amount } = payment
    const transactionExists = transactionAddress === transactionHash
    const withSameToken = amount.token.address === token
    return transactionExists && withSameToken
  })

  if (!paymentExists) {
    const transactionToken = tokens.find(_token => _token.address === token)
    const currentPayment = payment({ ...event, token: transactionToken })
    payments.push(currentPayment)
  }

  return { ...state, employees, payments }
}

// Management-related handlers
async function onAddAllowedToken(
  state,
  { returnValues: { token: newTokenAddress } }
) {
  const { allowedTokens = [] } = state

  if (
    !allowedTokens.find(({ address }) =>
      addressesEqual(address, newTokenAddress)
    )
  ) {
    const newAllowedToken = await getTokenDetails(newTokenAddress)

    if (newAllowedToken) {
      return { ...state, allowedTokens: allowedTokens.concat(newAllowedToken) }
    }
  }

  return state
}

async function onSetPriceFeed(state, event) {
  const priceFeedAddress = await app.call('feed').toPromise()
  return { ...state, priceFeedAddress }
}

async function onSetRateExpiryTime(state, event) {
  const rateExpiryTime = time(await app.call('rateExpiryTime').toPromise())

  return { ...state, rateExpiryTime }
}

// Utilities
async function updateEmployees(
  state,
  { employeeId, ...newEmployeeData },
  transform
) {
  const nextEmployees = Array.isArray(employees) ? Array.from(employees) : []

  const employeeIndex = nextEmployees.findIndex(
    e => e.employeeId === employeeId
  )
  // TODO: make sure fetch update only includes changed keys (fetches from chain only if not removed)
  const updatedEmployee = fetchEmployeeUpdate(employeeId, newDataForEmployee)

  return transform(nextEmployees, updatedEmployee)
}

async function updateEmployeeByAddress(state, event) {
  const {
    returnValues: { employee: employeeAddress },
  } = event
  const { employees: prevEmployees } = state
  const employeeData = await getEmployeeByAddress(employeeAddress)

  const byAddress = employee => employee.accountAddress === employeeAddress
  return updateEmployeeBy(prevEmployees, employeeData, byAddress)
}

async function updateEmployeeById(state, event) {
  const {
    returnValues: { employeeId },
  } = event
  const { employees: prevEmployees } = state
  const employeeData = await getEmployeeById(employeeId)

  const byId = employee => employee.id === employeeId
  return updateEmployeeBy(prevEmployees, employeeData, byId)
}

function updateEmployeeBy(employees, employeeData, by) {
  let nextEmployees = [...employees]

  if (!nextEmployees.find(by)) {
    nextEmployees.push(employeeData)
  } else {
    nextEmployees = nextEmployees.map(employee => {
      let nextEmployee = {
        ...employee,
      }

      if (by(employee)) {
        nextEmployee = {
          ...employeeData,
          name: employee.name,
          role: employee.role,
          startDate: employee.startDate,
        }
      }
      return nextEmployee
    })
  }

  return nextEmployees
}
