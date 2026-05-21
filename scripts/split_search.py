from math import inf


def estimate_output(base_output, price_impact, input_amount, original_amount):
    ratio = input_amount / original_amount
    return base_output * ratio * (1 - price_impact * ratio / 100)


def evaluate_split(route_a, route_b, total_input, original_amount, pct_a):
    input_a = total_input * pct_a / 100
    input_b = total_input * (100 - pct_a) / 100
    output_a = estimate_output(route_a['outputAmount'], route_a['priceImpact'], input_a, original_amount)
    output_b = estimate_output(route_b['outputAmount'], route_b['priceImpact'], input_b, original_amount)
    gas_a = route_a['gasCostUSD'] * 1.4
    gas_b = route_b['gasCostUSD'] * 1.4
    return output_a + output_b - gas_a - gas_b


def best_split(route_a, route_b):
    best = -inf
    best_pct = 20
    for pct in range(20, 81):
        net = evaluate_split(route_a, route_b, 10, 10, pct)
        if net > best:
            best = net
            best_pct = pct
    return best, best_pct


found = False
for outA in range(900, 1501, 50):
    for piA in [x * 0.1 for x in range(1, 21)]:
        for gasA in [x * 0.25 for x in range(2, 13)]:
            routeA = {'outputAmount': float(outA), 'priceImpact': float(piA), 'gasCostUSD': float(gasA)}
            for outB in range(900, 1501, 50):
                for piB in [x * 0.1 for x in range(1, 21)]:
                    for gasB in [x * 0.25 for x in range(2, 13)]:
                        routeB = {'outputAmount': float(outB), 'priceImpact': float(piB), 'gasCostUSD': float(gasB)}
                        if routeA == routeB:
                            continue
                        single = max(routeA['outputAmount'] * (1 - routeA['priceImpact'] / 100) - routeA['gasCostUSD'], routeB['outputAmount'] * (1 - routeB['priceImpact'] / 100) - routeB['gasCostUSD'])
                        best, best_pct = best_split(routeA, routeB)
                        improvement = (best - single) / max(single, 1) * 10000
                        if improvement > 5:
                            print('FOUND', routeA, routeB, 'single', round(single, 2), 'best', round(best, 2), 'bps', round(improvement, 2), 'pct', best_pct)
                            found = True
                            break
                    if found:
                        break
                if found:
                    break
            if found:
                break
        if found:
            break
    if found:
        break
if not found:
    print('none found in broad scan')
